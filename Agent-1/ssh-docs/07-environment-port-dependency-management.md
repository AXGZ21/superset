# Environment, Port & Dependency Management Across AI Coding Agents

## Executive Summary

This document analyzes how 9 AI coding agent orchestration tools handle three critical concerns when managing multiple isolated workspaces:

1. **Environment Variables** - How env vars are transferred to worktrees/containers/remotes
2. **Port Management** - How port conflicts are detected and resolved
3. **Dependency Setup/Teardown** - How dependencies are installed and cleaned up

---

## Comparison Matrix

| Project | Env Transfer | Port Strategy | Dependency Management | Setup Hooks |
|---------|--------------|---------------|----------------------|-------------|
| **Auto-Claude** | Copy .env files | 7-level detection | Per-worktree install | Git hooks |
| **Superset (Claude Squad)** | Shell env capture + inject | Pattern detection + health check | Config-based setup/teardown | Agent wrappers |
| **Mux** | NON_INTERACTIVE_ENV overlay | OS-assigned (port 0) | `.mux/init` hook | Init hooks |
| **Catnip** | Dockerfile ENV + /etc/profile.d | PORTZ array pool | Multi-phase Docker build | Init.d service |
| **OpenCode** | Instance-scoped process.env | Auto-fallback (4096 → OS) | Lock-based bun install | Bootstrap sequence |
| **Chorus** | Tauri store (key-value) | Hardcoded per service | Tauri plugin migrations | Provider chain |
| **VibeTunnel** | CLI args + env vars | Fixed port + exit on conflict | postinstall with fallbacks | Graceful shutdown |
| **Happy** | Expo config + MMKV | Server-driven (not client) | InvalidateSync pattern | Provider stack |
| **Vibe Kanban** | Rust env::var | Smart allocation + persistence | SQLx migrations | Cleanup tasks |

---

## 1. Environment Variable Management

### Best Implementation: Auto-Claude

**Pattern**: Copy `.env` files to worktrees with intelligent detection

```python
# Auto-Claude: apps/backend/core/workspace/setup.py
def copy_env_files_to_worktree(project_dir: Path, worktree_path: Path) -> list[str]:
    """
    Copy .env files from project root to worktree (without overwriting).
    """
    copied = []
    env_patterns = [
        ".env",
        ".env.local",
        ".env.development",
        ".env.development.local",
        ".env.test",
        ".env.test.local",
    ]

    for pattern in env_patterns:
        env_file = project_dir / pattern
        if env_file.is_file():
            target = worktree_path / pattern
            if not target.exists():  # Non-destructive
                shutil.copy2(env_file, target)
                copied.append(pattern)

    return copied
```

**Why it's good**:
- Searches multiple `.env` variants
- Non-destructive (doesn't overwrite existing)
- Works with standard tooling expectations

### Runner-Up: Superset (Claude Squad)

**Pattern**: Capture full shell environment + inject workspace-specific vars

```typescript
// Superset: apps/desktop/src/main/lib/terminal/env.ts
export function buildTerminalEnv(params: {
  shell: string;
  paneId: string;
  workspaceId: string;
  workspacePath?: string;
}): Record<string, string> {
  // 1. Get full shell environment via login shell
  const shellEnv = await getShellEnvironment(); // Cached 1 min

  // 2. Inject Superset-specific variables
  return {
    ...shellEnv,
    SUPERSET_PANE_ID: params.paneId,
    SUPERSET_WORKSPACE_ID: params.workspaceId,
    SUPERSET_WORKSPACE_PATH: params.workspacePath,
    SUPERSET_PORT: PORTS.NOTIFICATIONS,
    TERM_PROGRAM: "Superset",
    COLORTERM: "truecolor",
  };
}
```

**Why it's good**:
- Captures user's full shell environment (PATH, aliases, etc.)
- Caches to avoid repeated shell spawns
- Adds tool-specific vars for hooks/integrations

### Mux: Non-Interactive Overlay

**Pattern**: Overlay non-interactive vars to prevent blocking prompts

```typescript
// Mux: src/common/constants/env.ts
export const NON_INTERACTIVE_ENV_VARS = {
  GIT_EDITOR: "true",           // Prevents interactive editor
  GIT_SEQUENCE_EDITOR: "true",
  EDITOR: "true",
  VISUAL: "true",
  GIT_TERMINAL_PROMPT: "0",     // Disables git credential prompts
} as const;

// Applied after user env to override
env: {
  ...process.env,
  ...(options.env ?? {}),
  ...NON_INTERACTIVE_ENV_VARS,  // Last = highest priority
}
```

### Catnip: Container Profile Pattern

**Pattern**: Multi-layer environment setup for containers

```bash
# Catnip: /etc/profile.d/catnip.sh (sourced on shell init)
export NVM_DIR="${CATNIP_ROOT}/nvm"
export GOROOT="${CATNIP_ROOT}/go"
export GOPATH="${CATNIP_ROOT}/go-workspace"
export PNPM_HOME="${CATNIP_ROOT}/pnpm"
export PATH="${CATNIP_ROOT}/go/bin:${GOPATH}/bin:${CATNIP_ROOT}/bin:${PNPM_HOME}:${PATH}"

# Load NVM
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

```bash
# Runtime version overrides via environment
if [ -n "$CATNIP_NODE_VERSION" ]; then
    nvm install "$CATNIP_NODE_VERSION" && nvm use "$CATNIP_NODE_VERSION"
fi
if [ -n "$CATNIP_PYTHON_VERSION" ]; then
    uv python install "$CATNIP_PYTHON_VERSION"
fi
```

---

## 2. Port Management

### Best Implementation: Vibe Kanban

**Pattern**: Smart allocation with conflict detection + persistence

```javascript
// Vibe Kanban: scripts/setup-dev-environment.js

// Check if port is available
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: "localhost" });
    sock.on("connect", () => { sock.destroy(); resolve(false); });
    sock.on("error", () => resolve(true));
  });
}

// Find next free port
async function findFreePort(startPort = 3000) {
  let port = startPort;
  while (!(await isPortAvailable(port))) {
    port++;
    if (port > 65535) throw new Error("No available ports found");
  }
  return port;
}

// Persist ports for reuse
async function allocatePorts() {
  // 1. Check PORT env variable for manual override
  if (process.env.PORT) {
    return { frontend: PORT, backend: PORT + 1 };
  }

  // 2. Try to load existing ports from .dev-ports.json
  const existingPorts = loadPorts();
  if (await verifyPorts(existingPorts)) {
    return existingPorts;
  }

  // 3. Find new free ports
  const frontendPort = await findFreePort(3000);
  const backendPort = await findFreePort(frontendPort + 1);

  savePorts({ frontend: frontendPort, backend: backendPort });
  return { frontend: frontendPort, backend: backendPort };
}
```

**Why it's good**:
- Detects conflicts before binding
- Persists across sessions (reuses same ports when available)
- Falls back gracefully when saved ports are taken

### Runner-Up: Auto-Claude

**Pattern**: 7-level port detection from multiple sources

```python
# Auto-Claude: apps/backend/analysis/analyzers/port_detector.py
def detect_port_from_sources(self, default_port: int) -> int:
    """
    Robustly detect the actual port by checking multiple sources (priority):
    1. Entry point files (app.py, main.py, etc.)
    2. Environment files (.env, .env.local, .env.development)
    3. Docker Compose port mappings
    4. Configuration files (config.py, settings.py, etc.)
    5. Package.json scripts (for Node.js)
    6. Makefile/shell scripts
    7. Falls back to default_port if nothing found
    """

    # Pattern matching for different frameworks
    patterns = {
        'python': [
            r'uvicorn\.run\([^)]*port\s*=\s*(\d+)',
            r'app\.run\([^)]*port\s*=\s*(\d+)',
            r'os\.getenv\(["\']PORT["\']\s*,\s*(\d+)\)',
        ],
        'javascript': [
            r'\.listen\((\d+)\)',
            r'const\s+PORT\s*=\s*(\d+)',
            r'process\.env\.PORT\s*\|\|\s*(\d+)',
        ],
        'go': [r':(\d+)'],
        'rust': [r'\.bind\(["\']127\.0\.0\.1:(\d+)["\']\)'],
    }
```

### Superset: Pattern Detection + Health Check

**Pattern**: Detect ports from terminal output + verify they're listening

```typescript
// Superset: apps/desktop/src/main/lib/terminal/port-manager.ts
class PortManager {
  // 13+ regex patterns for different frameworks
  private patterns = [
    /listening on port (\d+)/i,
    /server running at :(\d+)/i,
    /http:\/\/localhost:(\d+)/i,
    /started server on.*:(\d+)/,
    // ... more patterns
  ];

  // Verify port is actually listening before adding
  async schedulePortVerification(port: number, paneId: string) {
    await sleep(500); // Wait for server to fully start

    // Try both IPv4 and IPv6
    const isListening = await Promise.race([
      this.checkPort('127.0.0.1', port),
      this.checkPort('::1', port),
      sleep(2000).then(() => false), // Timeout
    ]);

    if (isListening && !this.isPortTracked(port)) {
      this.addPort(port, paneId);
    }
  }

  // Only one entry per port globally
  private isPortTracked(port: number): boolean {
    for (const detected of this.ports.values()) {
      if (detected.port === port) return true;
    }
    return false;
  }
}
```

### Catnip: Port Pool Array

**Pattern**: Pre-allocated port array for multiple services

```bash
# Catnip: container/setup/entrypoint.sh
# SSH environment with port pool
cat > /home/catnip/.ssh/environment <<EOF
PORT=3000
PORTZ=[3001,3002,3003,3004,3005]
EOF
```

```bash
# container/setup-env.sh - Extract from pool
if [ -n "$PORTZ" ]; then
    FIRST_PORT=$(echo "$PORTZ" | jq -r '.[0] // empty')
    if [ -n "$FIRST_PORT" ]; then
        export VITE_PORT="$FIRST_PORT"
    fi
fi
```

### Mux/OpenCode: OS-Assigned Ports

**Pattern**: Let OS assign port, write to lockfile for discovery

```typescript
// Mux: src/node/services/serverService.ts
const server = opts.port === 0
  ? tryServe(0)  // OS assigns port
  : tryServe(opts.port);

// Write assigned port to lockfile
await lockfile.acquire(server.url, token, {
  port: server.address()?.port,
});

// OpenCode: similar with fallback
const server = opts.port === 0
  ? (tryServe(4096) ?? tryServe(0))  // Try 4096 first, then OS
  : tryServe(opts.port);
```

---

## 3. Dependency Setup/Teardown

### Best Implementation: Superset

**Pattern**: Config-based setup/teardown commands

```typescript
// Superset: apps/desktop/src/shared/types/config.ts
export interface SetupConfig {
  setup?: string[];    // Commands to run on workspace creation
  teardown?: string[]; // Commands to run on workspace deletion
}

// .superset/config.json
{
  "setup": ["npm install", "npm run build"],
  "teardown": ["npm run clean", "docker-compose down"]
}
```

```typescript
// apps/desktop/src/lib/trpc/routers/workspaces/utils/teardown.ts
export async function runTeardown(
  mainRepoPath: string,
  worktreePath: string,
  workspaceName: string,
): Promise<TeardownResult> {
  const config = loadSetupConfig(mainRepoPath);

  if (!config?.teardown?.length) {
    return { success: true };
  }

  const command = config.teardown.join(" && ");

  const shellEnv = await getShellEnvironment();

  execSync(command, {
    cwd: worktreePath,
    timeout: 60_000, // 60 second timeout
    env: {
      ...shellEnv,
      SUPERSET_WORKSPACE_NAME: workspaceName,
      SUPERSET_ROOT_PATH: mainRepoPath,
    },
  });

  return { success: true };
}
```

### Mux: Init Hook Pattern

**Pattern**: Executable `.mux/init` script with streaming output

```bash
#!/usr/bin/env bash
# .mux/init - runs after workspace creation
set -e

bun install
bun run build
```

```typescript
// Mux: src/node/runtime/initHook.ts
export async function checkInitHookExists(projectPath: string): Promise<boolean> {
  const hookPath = path.join(projectPath, ".mux", "init");
  try {
    await fsPromises.access(hookPath, fs.constants.X_OK); // Check executable
    return true;
  } catch {
    return false;
  }
}

// Environment passed to hook
export function getMuxEnv(projectPath: string, runtime: string, workspaceName: string) {
  return {
    MUX_PROJECT_PATH: projectPath,
    MUX_RUNTIME: runtime,        // "local", "worktree", or "ssh"
    MUX_WORKSPACE_NAME: workspaceName,
  };
}
```

```typescript
// Line-buffered streaming output
class LineBuffer {
  private buffer = "";

  append(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? ""; // Keep incomplete line
    for (const line of lines) {
      if (line) this.logLine(line);
    }
  }

  flush(): void {
    if (this.buffer) {
      this.logLine(this.buffer);
      this.buffer = "";
    }
  }
}
```

### Catnip: Multi-Phase Docker Build

**Pattern**: Dependencies installed at multiple lifecycle stages

```dockerfile
# Phase 1: Docker build time
FROM ubuntu:22.04

# Go dependencies
COPY container/go.mod container/go.sum ./
RUN go mod download

# Node.js with corepack
RUN corepack enable && \
    corepack install -g yarn@stable pnpm@latest

# Python with uv
RUN pipx install uv
```

```bash
# Phase 2: on-create.sh (container creation)
cd /workspaces/catnip && bash setup.sh
```

```bash
# Phase 3: post-start.sh (container start)
sudo service catnip stop
cd /workspaces/catnip/container && just install
sudo service catnip start
```

### OpenCode: Lock-Based Installation

**Pattern**: Write lock prevents concurrent installs

```typescript
// OpenCode: packages/opencode/src/bun/index.ts
export async function install(pkg: string, version = "latest") {
  // Ensure only one install at a time
  using _ = await Lock.write("bun-install");

  const pkgjson = Bun.file(path.join(Global.Path.cache, "package.json"));
  const parsed = await pkgjson.json().catch(() => ({ dependencies: {} }));

  // Skip if already installed with correct version
  if (parsed.dependencies[pkg] === version) return;

  // Install with Bun
  await BunProc.run(["add", "--force", "--exact", pkg + "@" + version], {
    cwd: Global.Path.cache,
  });

  // Resolve actual version for "latest"
  if (version === "latest") {
    const installedPkg = await Bun.file(path.join(mod, "package.json")).json();
    version = installedPkg.version;
  }

  parsed.dependencies[pkg] = version;
  await Bun.write(pkgjson.name!, JSON.stringify(parsed, null, 2));
}
```

### Happy: InvalidateSync Pattern

**Pattern**: Smart invalidation with batching and cleanup

```typescript
// Happy: sources/utils/sync.ts
export class InvalidateSync {
  private _invalidated = false;
  private _invalidatedDouble = false;
  private _stopped = false;
  private _pendings: (() => void)[] = [];

  invalidate() {
    if (!this._invalidated) {
      this._invalidated = true;
      this._invalidatedDouble = false;
      this._doSync();
    } else {
      // Mark for re-run after current sync completes
      this._invalidatedDouble = true;
    }
  }

  async awaitQueue() {
    return new Promise<void>(resolve => {
      this._pendings.push(resolve);
    });
  }

  stop() {
    this._notifyPendings();
    this._stopped = true;
  }

  private _doSync = async () => {
    await backoff(async () => {
      if (this._stopped) return;
      await this._command();
    });

    if (this._invalidatedDouble) {
      this._invalidatedDouble = false;
      this._doSync(); // Re-run if invalidated during execution
    } else {
      this._invalidated = false;
      this._notifyPendings();
    }
  }
}
```

### VibeTunnel: Graceful Shutdown Sequence

**Pattern**: Ordered cleanup with timeouts

```typescript
// VibeTunnel: web/src/server/server.ts
const shutdown = async () => {
  if (localShuttingDown) {
    process.exit(1); // Force on second signal
  }
  localShuttingDown = true;

  // 1. Clear intervals
  clearInterval(_terminalCleanupInterval);
  clearInterval(_subscriptionCleanupInterval);

  // 2. Stop config watcher
  configService.stopWatching();

  // 3. Stop mDNS
  if (mdnsService.isActive()) {
    await mdnsService.stopAdvertising();
  }

  // 4. Stop tunnels (Tailscale, ngrok, Cloudflare)
  if (tailscaleServeService.isRunning()) {
    await tailscaleServeService.stop();
  }
  if (ngrokService?.isActive()) {
    await ngrokService.stop();
  }
  if (cloudflareService?.isActive()) {
    await cloudflareService.stop();
  }

  // 5. Close server
  server.close(() => process.exit(0));

  // 6. Force exit after 5 seconds
  setTimeout(() => process.exit(1), 5000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

### Vibe Kanban: Workspace Cleanup Tasks

**Pattern**: Periodic cleanup with environment control

```rust
// Vibe Kanban: crates/local-deployment/src/container.rs
impl LocalContainerService {
    pub async fn spawn_workspace_cleanup(&self) {
        // Clean orphan workspaces immediately on startup
        WorkspaceManager::cleanup_orphan_workspaces(&self.db.pool).await;

        // Spawn periodic cleanup (every 30 minutes)
        let mut interval = tokio::time::interval(Duration::from_secs(1800));
        tokio::spawn(async move {
            loop {
                interval.tick().await;
                Self::cleanup_expired_workspaces(&db).await.ok();
            }
        });
    }
}

// Disable via environment for development
pub async fn cleanup_orphan_workspaces(db: &Pool<Sqlite>) {
    if std::env::var("DISABLE_WORKTREE_ORPHAN_CLEANUP").is_ok() {
        return; // Skip cleanup in dev
    }
    // ... cleanup logic
}
```

---

## Recommendations for Superset

### Environment Variables

1. **Keep current approach** (shell env capture + workspace vars)
2. **Add**: Copy `.env` files to worktrees (Auto-Claude pattern)
3. **Add**: Non-interactive overlay for agent execution (Mux pattern)

```typescript
// Recommended: Combined approach
async function buildWorkspaceEnv(workspace: Workspace): Promise<Record<string, string>> {
  // 1. Capture shell environment
  const shellEnv = await getShellEnvironment();

  // 2. Copy .env files to worktree (if not exists)
  await copyEnvFiles(workspace.mainRepoPath, workspace.worktreePath);

  // 3. Load .env from worktree
  const dotenv = parseDotenv(path.join(workspace.worktreePath, '.env'));

  // 4. Add workspace-specific vars
  const workspaceEnv = {
    SUPERSET_WORKSPACE_ID: workspace.id,
    SUPERSET_WORKSPACE_PATH: workspace.worktreePath,
    SUPERSET_ROOT_PATH: workspace.mainRepoPath,
  };

  // 5. Add non-interactive overrides (highest priority)
  const nonInteractive = {
    GIT_EDITOR: 'true',
    GIT_TERMINAL_PROMPT: '0',
    CI: 'true',
  };

  return { ...shellEnv, ...dotenv, ...workspaceEnv, ...nonInteractive };
}
```

### Port Management

1. **Enhance current detection** with health checks (verify port is listening)
2. **Add port persistence** across sessions (Vibe Kanban pattern)
3. **Add port pool** for cloud workers (Catnip PORTZ pattern)

```typescript
// Recommended: Port manager with persistence
class PortManager {
  private portsFile = path.join(workspace.path, '.superset-ports.json');

  async allocatePort(serviceName: string): Promise<number> {
    // 1. Check persisted ports
    const saved = await this.loadSavedPorts();
    if (saved[serviceName] && await this.isPortAvailable(saved[serviceName])) {
      return saved[serviceName];
    }

    // 2. Find free port
    const port = await this.findFreePort(3000);

    // 3. Save for reuse
    saved[serviceName] = port;
    await this.savePorts(saved);

    return port;
  }

  async verifyPort(port: number): Promise<boolean> {
    // Check both IPv4 and IPv6
    const checks = [
      this.checkPort('127.0.0.1', port),
      this.checkPort('::1', port),
    ];
    return Promise.race([
      Promise.any(checks),
      sleep(2000).then(() => false),
    ]);
  }
}
```

### Dependency Setup/Teardown

1. **Keep config-based approach** (setup/teardown arrays)
2. **Add**: Init hook support (`.superset/init` executable) for complex setups
3. **Add**: Streaming output with line buffering (Mux pattern)
4. **Add**: Graceful shutdown sequence (VibeTunnel pattern)

```typescript
// Recommended: Combined setup system
interface WorkspaceConfig {
  setup?: string[];          // Simple commands
  teardown?: string[];       // Simple cleanup
  initHook?: boolean;        // Enable .superset/init script
  setupTimeout?: number;     // Default 5 minutes
  teardownTimeout?: number;  // Default 1 minute
}

async function initializeWorkspace(workspace: Workspace): Promise<void> {
  const config = await loadWorkspaceConfig(workspace);

  // 1. Copy env files
  await copyEnvFiles(workspace);

  // 2. Run setup commands
  if (config.setup?.length) {
    for (const cmd of config.setup) {
      await runWithStreaming(cmd, workspace, config.setupTimeout);
    }
  }

  // 3. Run init hook if exists
  const hookPath = path.join(workspace.worktreePath, '.superset', 'init');
  if (await isExecutable(hookPath)) {
    await runInitHook(hookPath, workspace, config.setupTimeout);
  }
}

async function cleanupWorkspace(workspace: Workspace): Promise<void> {
  const config = await loadWorkspaceConfig(workspace);

  // Run teardown with timeout
  if (config.teardown?.length) {
    const cmd = config.teardown.join(' && ');
    await runWithTimeout(cmd, workspace, config.teardownTimeout ?? 60_000);
  }
}
```

### For Cloud Workers

```typescript
// Port pool for cloud workers (Catnip pattern)
interface CloudWorkerConfig {
  port: number;           // Primary port
  portPool: number[];     // Additional ports for services
}

// Passed to worker via environment
const workerEnv = {
  PORT: '3000',
  PORTZ: JSON.stringify([3001, 3002, 3003, 3004, 3005]),
  SUPERSET_WORKER_ID: worker.id,
};
```

---

## Summary

| Concern | Best Pattern | Adopt From |
|---------|--------------|------------|
| Env transfer | Copy .env + shell capture + overlay | Auto-Claude + Superset + Mux |
| Port allocation | Detect + verify + persist | Vibe Kanban + Superset |
| Port pools | Pre-allocated array | Catnip |
| Setup hooks | Config + executable hook | Superset + Mux |
| Streaming output | Line-buffered logger | Mux |
| Graceful shutdown | Ordered cleanup + timeout | VibeTunnel |
| Cleanup tasks | Periodic + on-demand | Vibe Kanban |
