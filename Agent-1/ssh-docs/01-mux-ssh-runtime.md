# Mux SSH Runtime - Deep Technical Analysis

## Overview

Mux implements the **most sophisticated SSH runtime** among all analyzed competitors. It provides a first-class SSH execution environment alongside local and worktree runtimes, with production-grade connection pooling, health tracking, and workspace management.

**Key Files**:
- `src/node/runtime/SSHRuntime.ts` (1388 lines)
- `src/node/runtime/sshConnectionPool.ts` (470 lines)
- `src/node/services/ptyService.ts`
- `docs/runtime/ssh.mdx`

---

## Architecture

### Three Runtime Types

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MUX RUNTIME SYSTEM                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌───────────────┐   ┌───────────────┐   ┌───────────────┐                │
│   │    LOCAL      │   │   WORKTREE    │   │     SSH       │                │
│   │   Runtime     │   │    Runtime    │   │   Runtime     │                │
│   ├───────────────┤   ├───────────────┤   ├───────────────┤                │
│   │ Project dir   │   │ ~/.mux/src/   │   │ Remote host   │                │
│   │ No isolation  │   │ Git worktrees │   │ Full isolation│                │
│   │ Direct exec   │   │ Branch isolat │   │ SSH transport │                │
│   └───────────────┘   └───────────────┘   └───────────────┘                │
│                                                                              │
│                              ┌─────────────────────┐                        │
│                              │  Runtime Interface  │                        │
│                              │  exec(), readFile() │                        │
│                              │  writeFile(), stat()│                        │
│                              └─────────────────────┘                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### SSH Configuration Schema

```typescript
interface SSHRuntimeConfig {
  host: string;              // hostname, user@host, or SSH config alias
  srcBaseDir: string;        // Remote working directory (absolute path)
  bgOutputDir?: string;      // Background process output (default: /tmp/mux-bashes)
  identityFile?: string;     // Path to SSH private key
  port?: number;             // SSH port (default: 22)
}
```

---

## Connection Pool Architecture

### Health Tracking System

The connection pool implements sophisticated health monitoring:

```typescript
interface ConnectionHealth {
  status: 'healthy' | 'unhealthy' | 'unknown';
  lastSuccess?: Date;
  lastFailure?: Date;
  lastError?: string;
  backoffUntil?: Date;
  consecutiveFailures: number;
}
```

### Backoff Strategy

```
Failure #1: Wait 1 second
Failure #2: Wait 2 seconds
Failure #3: Wait 4 seconds
Failure #4: Wait 7 seconds
Failure #5+: Wait 10 seconds (capped)

+ Random jitter: ±20% to prevent thundering herd
```

### Connection Multiplexing

Uses SSH ControlMaster for connection reuse:

```typescript
const sshArgs = [
  '-o', 'ControlMaster=auto',
  '-o', `ControlPath=${controlPath}`,  // Hash-based: mux-ssh-{sha256(config).slice(0,12)}
  '-o', 'ControlPersist=60',           // Keep master alive 60s after last use
  '-o', 'ConnectTimeout=15',           // 15s connection timeout
  '-o', 'ServerAliveInterval=5',       // 5s keepalive
  '-o', 'ServerAliveCountMax=2',       // 2 missed = dead
];
```

### Singleflighting

Prevents thundering herd when multiple requests probe same host:

```typescript
async acquireConnection(config: SSHRuntimeConfig, options?: AcquireConnectionOptions) {
  // 1. Check backoff state
  if (inBackoff && options.maxWaitMs === 0) {
    throw new Error('Connection in backoff');
  }

  // 2. Return if known-healthy (< 15s old)
  if (isHealthy && age < HEALTHY_TTL) {
    return;
  }

  // 3. Check for inflight probe (singleflighting)
  if (inflightProbe) {
    return await inflightProbe;
  }

  // 4. Start new probe
  const probe = performHealthCheck();
  inflightProbes.set(key, probe);
  await probe;
  inflightProbes.delete(key);
}
```

---

## Command Execution

### Dual Timeout Strategy

Commands have both local and remote timeouts for reliability:

```typescript
async exec(command: string, options: ExecOptions): Promise<ExecStream> {
  const localTimeout = options.timeout || 120_000;
  const remoteTimeout = Math.ceil(localTimeout / 1000) + 1;  // 1s longer

  // Wrap command with remote timeout
  const wrappedCommand = `timeout -s KILL ${remoteTimeout} bash -c ${shellQuote(command)}`;

  // Local timeout cancels via SIGKILL
  const timeoutId = setTimeout(() => process.kill('SIGKILL'), localTimeout);

  // Execute via SSH
  const proc = spawn('ssh', [...sshArgs, config.host, wrappedCommand]);

  return {
    stdout: Readable.toWeb(proc.stdout),
    stderr: Readable.toWeb(proc.stderr),
    stdin: Writable.toWeb(proc.stdin),
    exitCode: proc.exitCode,
  };
}
```

### Environment Variable Injection

```typescript
const NON_INTERACTIVE_ENV_VARS = `
export TERM=dumb
export PAGER=cat
export GIT_PAGER=cat
export GIT_TERMINAL_PROMPT=0
export CI=true
`;

// Prepended to every command
const fullCommand = `${NON_INTERACTIVE_ENV_VARS}; cd ${cwd}; ${command}`;
```

### Health Reporting

```typescript
// Exit code 255 = SSH connection failure
if (exitCode === 255) {
  connectionPool.reportFailure(config, error);
} else {
  connectionPool.reportSuccess(config);
}
```

---

## File Operations

### Atomic Write Pattern

```typescript
async writeFile(path: string, abortSignal?: AbortSignal): WritableStream<Uint8Array> {
  const tempPath = `${path}.tmp.${Date.now()}`;

  // 1. Get original permissions
  const perms = await exec(`stat -c '%a' ${shellQuote(path)} 2>/dev/null || echo 644`);

  // 2. Resolve symlinks
  const realPath = await exec(`readlink -f ${shellQuote(path)}`);

  // 3. Write to temp file
  const writeStream = await exec(`cat > ${shellQuote(tempPath)}`);

  // 4. On close: chmod + atomic rename
  writeStream.on('close', async () => {
    await exec(`chmod ${perms} ${shellQuote(tempPath)}`);
    await exec(`mv ${shellQuote(tempPath)} ${shellQuote(realPath)}`);
  });

  return writeStream;
}
```

### Read File Streaming

```typescript
async readFile(path: string, abortSignal?: AbortSignal): ReadableStream<Uint8Array> {
  const { stdout } = await exec(`cat ${shellQuote(path)}`, {
    timeout: 5 * 60 * 1000,  // 5 minutes for large files
    abortSignal,
  });
  return stdout;
}
```

---

## Workspace Management

### Git Bundle Sync

Syncs local git repository to remote without rsync:

```typescript
async syncProjectToRemote(localPath: string, remotePath: string): Promise<void> {
  // 1. Create git bundle locally
  const bundleProc = spawn('git', ['bundle', 'create', '-', '--all'], { cwd: localPath });

  // 2. Pipe to remote via SSH
  const sshProc = spawn('ssh', [...sshArgs, config.host, `cat > ${remotePath}/repo.bundle`]);
  bundleProc.stdout.pipe(sshProc.stdin);

  // 3. Unbundle on remote
  await exec(`cd ${remotePath} && git clone repo.bundle . && rm repo.bundle`);
}
```

**Advantages over rsync**:
- Only tracked files (no node_modules, etc.)
- Full git history preserved
- No external dependencies
- Atomic transfer

### Workspace Lifecycle

```typescript
// Create workspace directory
async createWorkspace(workspacePath: string): Promise<void> {
  await exec(`mkdir -p ${shellQuote(path.dirname(workspacePath))}`);
}

// Initialize with git sync and branch checkout
async initWorkspace(options: InitWorkspaceOptions): Promise<void> {
  // 1. Sync git bundle (with 3 retries for transient failures)
  await retry(() => this.syncProjectToRemote(localPath, remotePath), 3);

  // 2. Checkout branch
  await exec(`git checkout ${branch} || git checkout -b ${branch} ${trunkBranch}`);

  // 3. Pull latest (best-effort)
  await exec(`git pull --ff-only || true`);

  // 4. Run init hook if present
  await exec(`[ -f .mux/init ] && bash .mux/init || true`);
}

// Delete with safety checks
async deleteWorkspace(workspacePath: string, force: boolean): Promise<void> {
  if (!force) {
    // Check for uncommitted changes
    const dirty = await exec(`git diff --quiet`);
    if (dirty.exitCode !== 0) {
      throw new Error('Uncommitted changes exist');
    }

    // Check for unpushed commits
    const unpushed = await exec(`git log --branches --not --remotes`);
    if (unpushed.stdout.trim()) {
      throw new Error('Unpushed commits exist');
    }
  }

  await exec(`rm -rf ${shellQuote(workspacePath)}`);
}
```

---

## Terminal PTY Support

### SSH Terminal Creation

```typescript
function createSSHTerminal(config: SSHRuntimeConfig, cwd: string): PTYProcess {
  const args = buildSSHArgs(config);
  args.push('-t');  // Force PTY allocation
  args.push(`cd ${expandTildeForSSH(cwd)} && exec $SHELL -i`);

  return pty.spawn('ssh', args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    env: { TERM: 'xterm-256color' },
  });
}
```

### Tilde Expansion for SSH

```typescript
// Local: expand to actual path
expandTilde('~/workspace')  // => '/home/user/workspace'

// SSH: expand to $HOME (quoted paths don't expand tilde)
expandTildeForSSH('~/workspace')  // => '$HOME/workspace'

// Generate CD command
cdCommandForSSH('~/workspace')  // => 'cd "$HOME/workspace"'
```

---

## Security Architecture

### Key Management

Delegates to system SSH - no embedded SSH client:
- Respects `~/.ssh/config` for aliases and ProxyJump
- Supports SSH Agent
- Supports custom identity files
- Default keys: `~/.ssh/id_rsa`, `~/.ssh/id_ecdsa`, `~/.ssh/id_ed25519`

### Host Key Verification

```typescript
if (config.identityFile) {
  // Test environments: skip verification
  args.push('-o', 'StrictHostKeyChecking=no');
  args.push('-o', 'UserKnownHostsFile=/dev/null');
} else {
  // Production: normal verification via ~/.ssh/known_hosts
}
```

### Security Model

- Remote machine considered potentially hostile
- No implicit credential transfer
- Prompt injection risk contained to remote
- Parallel execution without local machine impact

---

## Testing Infrastructure

### Docker-Based SSH Server

```typescript
// tests/runtime/test-fixtures/ssh-fixture.ts

async function startSSHServer(): Promise<SSHTestConfig> {
  // 1. Generate ephemeral SSH key
  await exec(`ssh-keygen -t rsa -b 2048 -f ${keyPath} -N ""`);

  // 2. Build Docker image
  await exec(`docker build -t mux-ssh-test ./ssh-server`);

  // 3. Start container with dynamic port
  const containerId = await exec(`docker run -d --rm -p 0:22 mux-ssh-test`);

  // 4. Wait for SSH ready
  await retry(() => exec(`ssh -o ConnectTimeout=1 testuser@localhost -p ${port} exit`));

  return { host: `testuser@localhost:${port}`, privateKeyPath: keyPath };
}
```

---

## UX Considerations

### User-Facing Configuration

```yaml
# mux.yaml
runtime:
  type: ssh
  host: user@server.example.com
  srcBaseDir: /home/user/projects/myapp
  # Optional:
  port: 22
  identityFile: ~/.ssh/mykey
  bgOutputDir: /tmp/mux-bashes
```

### Host Format Flexibility

Supports multiple formats:
- `hostname` - Uses default user
- `user@hostname` - Explicit user
- `myalias` - SSH config alias (from `~/.ssh/config`)

### Coder Workspaces Integration

```bash
# Configure SSH for Coder workspaces
coder config-ssh

# Use workspace name as host
runtime:
  type: ssh
  host: myworkspace
```

---

## Error Handling

### Exit Code Semantics

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | Mark healthy |
| 124 | Timeout | Command timeout, connection OK |
| 255 | SSH error | Mark unhealthy, trigger backoff |
| Other | Command error | Mark healthy (connection worked) |

### Self-Healing Behaviors

1. **Automatic retry**: Transient failures trigger backoff + retry
2. **Healthy caching**: Skip re-probing healthy connections for 15s
3. **Singleflighting**: Concurrent requests share single probe
4. **Connection reuse**: ControlMaster reduces overhead
5. **Graceful degradation**: Clear error messages on failure

---

## Why This Implementation Excels

### Strengths

1. **Production-grade connection pool**: Health tracking, backoff, singleflighting
2. **Dual timeout strategy**: Both local and remote protection
3. **Atomic file writes**: No partial writes or corruption
4. **Git bundle sync**: Efficient, dependency-free workspace transfer
5. **System SSH delegation**: Leverages existing SSH infrastructure
6. **Comprehensive testing**: Docker-based ephemeral test environments
7. **Type-safe interfaces**: Full TypeScript throughout

### Trade-offs

1. **Requires system SSH**: Not self-contained
2. **No GUI key management**: Uses system keychain/agent
3. **Linux-focused**: Some commands assume POSIX environment
4. **No Windows support**: Unix-only implementation

---

## Key Patterns for Superset

1. **Connection pooling with health tracking** - Essential for reliability
2. **Dual timeout strategy** - Protects against hung connections
3. **Git bundle sync** - Clean workspace transfer without rsync
4. **ControlMaster multiplexing** - Performance optimization
5. **Singleflighting** - Prevents thundering herd
6. **Atomic file writes** - Data integrity protection
7. **System SSH delegation** - Leverage existing infrastructure
