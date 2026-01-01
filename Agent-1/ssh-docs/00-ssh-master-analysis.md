# SSH & Cloud Workspace Analysis - Master Document

## Executive Summary

After analyzing 9 AI coding agent orchestration tools, this document synthesizes the findings on SSH and cloud workspace implementations. It identifies best practices, architectural patterns, and provides actionable recommendations for building Superset's remote execution capabilities.

### Projects Analyzed

| Project | SSH/Remote Support | Approach |
|---------|-------------------|----------|
| **Mux** | Comprehensive | Full SSH runtime with connection pooling |
| **Catnip** | Comprehensive | Docker containers with SSH server inside |
| **VibeTunnel** | Comprehensive | Multi-provider tunnel system (Tailscale/ngrok/CF) |
| **Happy** | Remote control | WebSocket relay with E2E encryption |
| **OpenCode** | Limited | Remote MCP servers only |
| **Vibe Kanban** | Minimal | Remote editor integration only |
| **Auto-Claude** | None | Local git worktrees only |
| **Claude Squad** | None | Local tmux sessions only |
| **Chorus** | None | Local execution only |

---

## Architecture Comparison

### Approach Matrix

```
                    ┌─────────────────────────────────────────────────────────┐
                    │           REMOTE EXECUTION APPROACHES                    │
                    ├─────────────┬─────────────┬─────────────┬──────────────┤
                    │ Traditional │  Container  │   Tunnel    │    Relay     │
                    │    SSH      │   + SSH     │   Based     │    Based     │
                    ├─────────────┼─────────────┼─────────────┼──────────────┤
                    │    Mux      │   Catnip    │ VibeTunnel  │    Happy     │
                    ├─────────────┼─────────────┼─────────────┼──────────────┤
Isolation           │    Host     │  Container  │    Host     │     Host     │
Setup Complexity    │   Medium    │    Low      │     Low     │    Medium    │
NAT Traversal       │   Manual    │  Automatic  │  Automatic  │   Automatic  │
Security            │   SSH Keys  │  Ephemeral  │  Provider   │     E2E      │
Scalability         │    Good     │  Excellent  │    Good     │   Excellent  │
Offline Support     │     No      │     No      │     No      │     Yes      │
Mobile Support      │   Limited   │     No      │  Limited    │   Excellent  │
                    └─────────────┴─────────────┴─────────────┴──────────────┘
```

---

## Best Implementations by Category

### 1. Best SSH Runtime: Mux

**Why it excels:**
- Production-grade connection pooling with health tracking
- Singleflighting prevents thundering herd on connection probes
- Dual timeout strategy (local + remote) prevents hung connections
- Git bundle sync for efficient workspace transfer
- SSH ControlMaster multiplexing reduces overhead

**Key Code Pattern:**
```typescript
// Connection pool with health tracking
interface ConnectionHealth {
  status: 'healthy' | 'unhealthy' | 'unknown';
  lastSuccess?: Date;
  lastFailure?: Date;
  consecutiveFailures: number;
  backoffUntil?: Date;
}

// Dual timeout - remote timeout slightly longer than local
const localTimeout = options.timeout || 120_000;
const remoteTimeout = Math.ceil(localTimeout / 1000) + 1;
const command = `timeout -s KILL ${remoteTimeout} bash -c ${shellQuote(cmd)}`;
```

**UX Strengths:**
- Respects existing SSH config (`~/.ssh/config` aliases)
- Supports SSH agent for key management
- Clear error messages with exit code semantics

### 2. Best Container Architecture: Catnip

**Why it excels:**
- Multi-runtime abstraction (Docker, Apple Container SDK, Codespaces)
- SSH server inside container for secure access
- Port forwarding via SSH tunnels
- Docker-in-Docker support via socket proxying
- GitHub Codespaces integration

**Key Code Pattern:**
```typescript
// Multi-runtime interface
interface ContainerRuntime {
  create(config: ContainerConfig): Promise<Container>;
  start(id: string): Promise<void>;
  exec(id: string, command: string): Promise<ExecResult>;
  destroy(id: string): Promise<void>;
}

// SSH server inside container
const dockerfile = `
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y openssh-server
RUN mkdir -p /run/sshd
COPY authorized_keys /root/.ssh/authorized_keys
CMD ["/usr/sbin/sshd", "-D"]
`;
```

**UX Strengths:**
- One-click container creation
- Automatic port management
- Seamless Codespaces handoff

### 3. Best Tunnel System: VibeTunnel

**Why it excels:**
- Multi-provider support (Tailscale, ngrok, Cloudflare)
- Auto-detection of installed providers
- Provider-native authentication
- HQ mode for multi-agent orchestration
- Automatic failover between providers

**Key Code Pattern:**
```typescript
// Provider abstraction
interface TunnelProvider {
  name: string;
  isInstalled(): Promise<boolean>;
  isAuthenticated(): Promise<boolean>;
  startTunnel(options: TunnelOptions): Promise<TunnelConnection>;
  stopTunnel(id: string): Promise<void>;
}

// Automatic failover
async startWithFailover(options: TunnelOptions): Promise<TunnelConnection> {
  for (const provider of this.providers) {
    if (!await provider.isInstalled()) continue;
    try {
      return await provider.startTunnel(options);
    } catch {
      continue; // Try next provider
    }
  }
  throw new Error('All providers failed');
}
```

**UX Strengths:**
- Zero-config with Tailscale
- Quick URLs with ngrok
- Enterprise auth with Cloudflare Access

### 4. Best Security Model: Happy

**Why it excels:**
- True E2E encryption (relay cannot decrypt)
- Signal Protocol (X3DH + Double Ratchet)
- Forward secrecy and break-in recovery
- QR code pairing for frictionless setup
- Session persistence across restarts

**Key Code Pattern:**
```typescript
// Double Ratchet for forward secrecy
class DoubleRatchet {
  async ratchetEncrypt(plaintext: string): Promise<EncryptedMessage>;
  async ratchetDecrypt(message: EncryptedMessage): Promise<string>;
  private async dhRatchet(senderKey: CryptoKey): Promise<void>;
}

// Stateless relay - cannot store or read messages
class RelayServer {
  routeMessage(message: RelayMessage): void {
    const target = this.connections.get(message.to);
    target?.send(message.payload); // Encrypted, relay can't read
  }
}
```

**UX Strengths:**
- QR code pairing (scan and connected)
- Works behind any NAT/firewall
- Offline queue for disconnected operation

---

## Superset Recommendations

### Recommended Architecture: Hybrid Approach

Superset should combine the best elements from each implementation:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     SUPERSET REMOTE EXECUTION ARCHITECTURE                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                         ┌─────────────────────┐                             │
│                         │   Runtime Manager   │                             │
│                         │   (Abstraction)     │                             │
│                         └──────────┬──────────┘                             │
│                                    │                                         │
│         ┌──────────────────────────┼──────────────────────────┐             │
│         │                          │                          │              │
│         ▼                          ▼                          ▼              │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐        │
│  │    Local     │         │   Container  │         │    Remote    │        │
│  │   Runtime    │         │   Runtime    │         │   Runtime    │        │
│  │  (Current)   │         │   (Catnip)   │         │    (SSH)     │        │
│  └──────────────┘         └──────────────┘         └──────────────┘        │
│         │                          │                          │              │
│         │                          ▼                          │              │
│         │               ┌──────────────────┐                  │              │
│         │               │  Docker + SSH    │                  │              │
│         │               │  Codespaces      │                  │              │
│         │               └──────────────────┘                  │              │
│         │                                                     │              │
│         │                          ┌──────────────────────────┘              │
│         │                          │                                         │
│         │                          ▼                                         │
│         │               ┌──────────────────┐                                │
│         │               │ Connection Pool  │                                │
│         │               │ (Mux pattern)    │                                │
│         │               └──────────────────┘                                │
│         │                          │                                         │
│         │         ┌────────────────┼────────────────┐                       │
│         │         ▼                ▼                ▼                        │
│         │  ┌──────────┐    ┌──────────┐    ┌──────────┐                    │
│         │  │   SSH    │    │ Tailscale│    │  Tunnel  │                    │
│         │  │  Direct  │    │  Mesh    │    │  (ngrok) │                    │
│         │  └──────────┘    └──────────┘    └──────────┘                    │
│         │                                                                    │
│         └────────────────────────────────────────────────────────────────── │
│                                                                              │
│   ┌────────────────────────────────────────────────────────────────────┐   │
│   │                      Mobile Remote Control                          │   │
│   │                    (Happy WebSocket pattern)                        │   │
│   └────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 1: Foundation (Month 1-2)

#### 1.1 Runtime Abstraction Layer

Create a unified interface for all execution environments:

```typescript
// packages/runtime/src/types.ts
interface Runtime {
  readonly type: 'local' | 'container' | 'ssh';
  readonly id: string;

  // Lifecycle
  initialize(): Promise<void>;
  dispose(): Promise<void>;

  // Execution
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  spawn(command: string, options?: SpawnOptions): ChildProcess;

  // File operations
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat>;

  // Terminal
  createTerminal(options?: TerminalOptions): Promise<Terminal>;

  // Health
  healthCheck(): Promise<HealthStatus>;
}

interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

#### 1.2 SSH Connection Pool (from Mux)

```typescript
// packages/runtime/src/ssh/connection-pool.ts
interface SSHConnectionPool {
  // Acquire with health-aware routing
  acquire(config: SSHConfig, options?: AcquireOptions): Promise<SSHConnection>;

  // Report connection health
  reportSuccess(config: SSHConfig): void;
  reportFailure(config: SSHConfig, error: Error): void;

  // Pool management
  getHealth(config: SSHConfig): ConnectionHealth;
  drainAll(): Promise<void>;
}

class SSHConnectionPoolImpl implements SSHConnectionPool {
  private health: Map<string, ConnectionHealth> = new Map();
  private inflightProbes: Map<string, Promise<void>> = new Map();

  async acquire(config: SSHConfig, options?: AcquireOptions): Promise<SSHConnection> {
    const key = this.configKey(config);
    const health = this.health.get(key);

    // Check backoff state
    if (health?.backoffUntil && health.backoffUntil > new Date()) {
      if (options?.maxWaitMs === 0) {
        throw new Error(`Connection in backoff until ${health.backoffUntil}`);
      }
      await sleep(health.backoffUntil.getTime() - Date.now());
    }

    // Return if healthy and fresh
    if (health?.status === 'healthy' && this.isFresh(health)) {
      return this.createConnection(config);
    }

    // Singleflight: share inflight probe
    let probe = this.inflightProbes.get(key);
    if (!probe) {
      probe = this.performHealthCheck(config);
      this.inflightProbes.set(key, probe);
      probe.finally(() => this.inflightProbes.delete(key));
    }

    await probe;
    return this.createConnection(config);
  }

  private async performHealthCheck(config: SSHConfig): Promise<void> {
    const key = this.configKey(config);

    try {
      // Quick connectivity test
      await this.testConnection(config);
      this.reportSuccess(config);
    } catch (error) {
      this.reportFailure(config, error as Error);
      throw error;
    }
  }

  reportFailure(config: SSHConfig, error: Error): void {
    const key = this.configKey(config);
    const current = this.health.get(key) || this.defaultHealth();

    current.status = 'unhealthy';
    current.lastFailure = new Date();
    current.lastError = error.message;
    current.consecutiveFailures++;

    // Exponential backoff with jitter
    const baseDelay = Math.min(1000 * Math.pow(2, current.consecutiveFailures - 1), 10000);
    const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1);
    current.backoffUntil = new Date(Date.now() + baseDelay + jitter);

    this.health.set(key, current);
  }
}
```

#### 1.3 Dual Timeout Strategy (from Mux)

```typescript
// packages/runtime/src/ssh/exec.ts
async function sshExec(
  connection: SSHConnection,
  command: string,
  options: ExecOptions
): Promise<ExecResult> {
  const localTimeout = options.timeout || 120_000;
  const remoteTimeout = Math.ceil(localTimeout / 1000) + 1;

  // Wrap with remote timeout for reliability
  const wrappedCommand = `timeout -s KILL ${remoteTimeout} bash -c ${shellQuote(command)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), localTimeout);

  try {
    const result = await connection.exec(wrappedCommand, {
      signal: controller.signal,
      cwd: options.cwd,
      env: {
        ...NON_INTERACTIVE_ENV,
        ...options.env,
      },
    });

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

const NON_INTERACTIVE_ENV = {
  TERM: 'dumb',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
  GIT_TERMINAL_PROMPT: '0',
  CI: 'true',
};
```

### Phase 2: Container Runtime (Month 2-3)

#### 2.1 Container Runtime Interface (from Catnip)

```typescript
// packages/runtime/src/container/types.ts
interface ContainerRuntime {
  readonly provider: 'docker' | 'podman' | 'codespaces';

  create(config: ContainerConfig): Promise<Container>;
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  destroy(id: string): Promise<void>;

  exec(id: string, command: string, options?: ExecOptions): Promise<ExecResult>;
  copyTo(id: string, localPath: string, containerPath: string): Promise<void>;
  copyFrom(id: string, containerPath: string, localPath: string): Promise<void>;

  getInfo(id: string): Promise<ContainerInfo>;
  listContainers(): Promise<Container[]>;
}

interface ContainerConfig {
  image: string;
  name?: string;
  workingDir?: string;
  env?: Record<string, string>;
  ports?: PortMapping[];
  volumes?: VolumeMapping[];
  resources?: ResourceLimits;
  sshEnabled?: boolean;  // Enable SSH server inside container
}

interface PortMapping {
  host: number;
  container: number;
  protocol?: 'tcp' | 'udp';
}
```

#### 2.2 SSH-Enabled Container (from Catnip)

```typescript
// packages/runtime/src/container/ssh-container.ts
class SSHEnabledContainer implements Container {
  private sshPort: number;
  private sshKey: SSHKeyPair;

  async create(config: ContainerConfig): Promise<void> {
    // Generate ephemeral SSH key for this container
    this.sshKey = await generateSSHKey();
    this.sshPort = await findAvailablePort();

    // Create container with SSH server
    await this.docker.createContainer({
      Image: config.image,
      Cmd: ['/usr/sbin/sshd', '-D'],
      ExposedPorts: { '22/tcp': {} },
      HostConfig: {
        PortBindings: {
          '22/tcp': [{ HostPort: this.sshPort.toString() }],
        },
        Binds: config.volumes?.map(v => `${v.host}:${v.container}`),
      },
      Env: Object.entries(config.env || {}).map(([k, v]) => `${k}=${v}`),
    });

    // Copy SSH public key into container
    await this.copyAuthorizedKeys();
  }

  async getSSHConfig(): Promise<SSHConfig> {
    return {
      host: 'localhost',
      port: this.sshPort,
      username: 'root',
      privateKey: this.sshKey.privateKey,
    };
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    // Use SSH for execution (instead of docker exec)
    const sshConfig = await this.getSSHConfig();
    return sshExec(sshConfig, command, options);
  }

  private async copyAuthorizedKeys(): Promise<void> {
    const authKeys = this.sshKey.publicKey;
    await this.docker.putArchive(this.containerId, {
      path: '/root/.ssh',
      archive: createTarStream([
        { name: 'authorized_keys', content: authKeys, mode: 0o600 },
      ]),
    });
  }
}
```

#### 2.3 GitHub Codespaces Integration (from Catnip)

```typescript
// packages/runtime/src/container/codespaces.ts
class CodespacesRuntime implements ContainerRuntime {
  readonly provider = 'codespaces';

  async create(config: CodespacesConfig): Promise<Container> {
    // Use GitHub API to create codespace
    const response = await fetch('https://api.github.com/user/codespaces', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repository_id: config.repositoryId,
        ref: config.branch,
        machine: config.machineType || 'standardLinux32gb',
        devcontainer_path: config.devcontainerPath,
        idle_timeout_minutes: config.idleTimeout || 30,
      }),
    });

    const codespace = await response.json();
    return new CodespacesContainer(codespace);
  }

  async connect(codespace: CodespacesContainer): Promise<SSHConfig> {
    // Get SSH connection details
    const response = await fetch(
      `https://api.github.com/user/codespaces/${codespace.name}/exports`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ format: 'ssh' }),
      }
    );

    const { ssh_host, ssh_port, ssh_key } = await response.json();

    return {
      host: ssh_host,
      port: ssh_port,
      privateKey: ssh_key,
    };
  }
}
```

### Phase 3: Tunnel System (Month 3-4)

#### 3.1 Multi-Provider Tunnel Manager (from VibeTunnel)

```typescript
// packages/runtime/src/tunnel/manager.ts
interface TunnelManager {
  // Provider management
  detectProviders(): Promise<ProviderStatus[]>;
  getProvider(name: string): TunnelProvider;

  // Tunnel lifecycle
  startTunnel(options: TunnelOptions): Promise<TunnelConnection>;
  stopTunnel(id: string): Promise<void>;

  // Health monitoring
  getStatus(id: string): Promise<TunnelStatus>;
  onStatusChange(callback: (status: TunnelStatus) => void): () => void;
}

class TunnelManagerImpl implements TunnelManager {
  private providers: Map<string, TunnelProvider> = new Map();
  private activeTunnels: Map<string, TunnelConnection> = new Map();
  private healthMonitor: TunnelHealthMonitor;

  constructor() {
    this.providers.set('tailscale', new TailscaleProvider());
    this.providers.set('ngrok', new NgrokProvider());
    this.providers.set('cloudflare', new CloudflareProvider());

    this.healthMonitor = new TunnelHealthMonitor(this.activeTunnels);
    this.healthMonitor.start();
  }

  async detectProviders(): Promise<ProviderStatus[]> {
    const results: ProviderStatus[] = [];

    for (const [name, provider] of this.providers) {
      results.push({
        name,
        installed: await provider.isInstalled(),
        authenticated: await provider.isAuthenticated(),
        recommended: name === 'tailscale', // Best for teams
      });
    }

    return results;
  }

  async startTunnel(options: TunnelOptions): Promise<TunnelConnection> {
    // Auto-select provider if not specified
    const providerName = options.provider || await this.selectBestProvider();
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    const connection = await provider.startTunnel(options);
    this.activeTunnels.set(connection.id, connection);

    return connection;
  }

  private async selectBestProvider(): Promise<string> {
    // Priority: Tailscale > Cloudflare > ngrok
    const status = await this.detectProviders();

    for (const name of ['tailscale', 'cloudflare', 'ngrok']) {
      const provider = status.find(p => p.name === name);
      if (provider?.installed && provider?.authenticated) {
        return name;
      }
    }

    throw new Error('No tunnel provider available');
  }
}
```

#### 3.2 Tailscale Provider (from VibeTunnel)

```typescript
// packages/runtime/src/tunnel/tailscale.ts
class TailscaleProvider implements TunnelProvider {
  readonly name = 'tailscale';

  async isInstalled(): Promise<boolean> {
    try {
      await exec('tailscale version');
      return true;
    } catch {
      return false;
    }
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      const { stdout } = await exec('tailscale status --json');
      const status = JSON.parse(stdout);
      return status.BackendState === 'Running' && status.Self?.Online;
    } catch {
      return false;
    }
  }

  async startTunnel(options: TunnelOptions): Promise<TunnelConnection> {
    const hostname = await this.getHostname();

    if (options.publicAccess) {
      // Funnel: Public HTTPS access
      await exec(`tailscale funnel ${options.localPort}`);
      return {
        id: randomUUID(),
        provider: 'tailscale',
        publicUrl: `https://${hostname}`,
        localPort: options.localPort,
        status: 'connected',
        startedAt: new Date(),
      };
    } else {
      // Serve: Tailnet-only access
      await exec(`tailscale serve ${options.localPort}`);
      return {
        id: randomUUID(),
        provider: 'tailscale',
        publicUrl: `http://${hostname}:${options.localPort}`,
        localPort: options.localPort,
        status: 'connected',
        startedAt: new Date(),
      };
    }
  }

  private async getHostname(): Promise<string> {
    const { stdout } = await exec('tailscale status --json');
    const status = JSON.parse(stdout);
    return status.Self.DNSName.replace(/\.$/, '');
  }
}
```

### Phase 4: Mobile Remote Control (Month 4-5)

#### 4.1 WebSocket Relay (from Happy)

```typescript
// packages/relay/src/server.ts
class RelayServer {
  private connections: Map<string, WebSocket> = new Map();

  start(port: number): void {
    const wss = new WebSocketServer({ port });

    wss.on('connection', (ws, req) => {
      const deviceId = req.headers['x-device-id'] as string;
      this.handleConnection(ws, deviceId);
    });
  }

  private handleConnection(ws: WebSocket, deviceId: string): void {
    this.connections.set(deviceId, ws);
    this.broadcastPresence(deviceId, 'online');

    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());

      if (message.type === 'route') {
        // Route to target device (payload is encrypted, we can't read it)
        const target = this.connections.get(message.to);
        if (target?.readyState === WebSocket.OPEN) {
          target.send(JSON.stringify({
            type: 'message',
            from: deviceId,
            payload: message.payload,
            timestamp: Date.now(),
          }));
        }
      }
    });

    ws.on('close', () => {
      this.connections.delete(deviceId);
      this.broadcastPresence(deviceId, 'offline');
    });
  }
}
```

#### 4.2 E2E Encryption Layer (from Happy)

```typescript
// packages/crypto/src/ratchet.ts
class DoubleRatchet {
  private state: RatchetState;

  async encrypt(plaintext: string): Promise<EncryptedMessage> {
    const { messageKey, newChainKey } = await this.deriveMessageKey(
      this.state.sendingChainKey
    );
    this.state.sendingChainKey = newChainKey;

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      messageKey,
      new TextEncoder().encode(plaintext)
    );

    return {
      header: {
        publicKey: this.state.sendingRatchetKey.publicKey,
        messageNumber: this.state.sendingCounter++,
      },
      iv,
      ciphertext: new Uint8Array(ciphertext),
    };
  }

  async decrypt(message: EncryptedMessage): Promise<string> {
    // Check if we need DH ratchet step
    if (!keysEqual(message.header.publicKey, this.state.receivingRatchetKey)) {
      await this.dhRatchet(message.header.publicKey);
    }

    const { messageKey, newChainKey } = await this.deriveMessageKey(
      this.state.receivingChainKey
    );
    this.state.receivingChainKey = newChainKey;
    this.state.receivingCounter++;

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: message.iv },
      messageKey,
      message.ciphertext
    );

    return new TextDecoder().decode(plaintext);
  }
}
```

---

## UX Recommendations

### 1. Runtime Selection UI

```typescript
// apps/desktop/src/renderer/components/RuntimeSelector.tsx
interface RuntimeSelectorProps {
  onSelect: (runtime: RuntimeConfig) => void;
}

function RuntimeSelector({ onSelect }: RuntimeSelectorProps) {
  const [runtimes, setRuntimes] = useState<RuntimeStatus[]>([]);

  useEffect(() => {
    // Auto-detect available runtimes
    detectRuntimes().then(setRuntimes);
  }, []);

  return (
    <div className="runtime-selector">
      <h3>Select Runtime</h3>

      {/* Local (always available) */}
      <RuntimeCard
        name="Local"
        description="Run on this machine"
        icon={<ComputerIcon />}
        available={true}
        onSelect={() => onSelect({ type: 'local' })}
      />

      {/* Container (if Docker available) */}
      <RuntimeCard
        name="Container"
        description="Isolated Docker environment"
        icon={<ContainerIcon />}
        available={runtimes.find(r => r.name === 'docker')?.available}
        onSelect={() => onSelect({ type: 'container' })}
      />

      {/* SSH (show detected hosts) */}
      {runtimes.filter(r => r.type === 'ssh').map(host => (
        <RuntimeCard
          key={host.name}
          name={host.name}
          description={`SSH to ${host.host}`}
          icon={<ServerIcon />}
          available={host.available}
          onSelect={() => onSelect({ type: 'ssh', config: host })}
        />
      ))}

      {/* Codespaces (if GitHub authenticated) */}
      <RuntimeCard
        name="GitHub Codespaces"
        description="Cloud development environment"
        icon={<GitHubIcon />}
        available={runtimes.find(r => r.name === 'codespaces')?.available}
        onSelect={() => onSelect({ type: 'codespaces' })}
      />
    </div>
  );
}
```

### 2. Connection Status Indicators

```
┌─────────────────────────────────────────────────────────────────┐
│  Workspace: feature/auth                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Runtime: SSH (dev-server.company.com)                          │
│  Status: 🟢 Connected (latency: 45ms)                           │
│  Tunnel: Tailscale (dev-server.tailnet-xyz.ts.net)             │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Terminal                                                 │  │
│  │  user@dev-server:~/project$                              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [Reconnect] [Change Runtime] [Open Tunnel]                     │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Error Recovery UX

```typescript
// Graceful degradation with clear messaging
interface ConnectionError {
  code: 'TIMEOUT' | 'AUTH_FAILED' | 'HOST_UNREACHABLE' | 'TUNNEL_DOWN';
  message: string;
  recovery: RecoveryAction[];
}

const RECOVERY_ACTIONS: Record<string, RecoveryAction[]> = {
  TIMEOUT: [
    { label: 'Retry', action: 'retry' },
    { label: 'Increase timeout', action: 'configure_timeout' },
    { label: 'Switch to local', action: 'switch_local' },
  ],
  AUTH_FAILED: [
    { label: 'Re-authenticate', action: 'reauthenticate' },
    { label: 'Check SSH keys', action: 'open_ssh_docs' },
    { label: 'Use password', action: 'password_auth' },
  ],
  HOST_UNREACHABLE: [
    { label: 'Start tunnel', action: 'start_tunnel' },
    { label: 'Check firewall', action: 'open_firewall_docs' },
    { label: 'Use different host', action: 'select_host' },
  ],
  TUNNEL_DOWN: [
    { label: 'Restart tunnel', action: 'restart_tunnel' },
    { label: 'Try different provider', action: 'select_provider' },
    { label: 'Direct SSH', action: 'direct_ssh' },
  ],
};
```

---

## Implementation Priority Matrix

| Feature | Impact | Effort | Priority |
|---------|--------|--------|----------|
| Runtime abstraction | High | Medium | P0 |
| SSH connection pool | High | Medium | P0 |
| Container runtime | High | High | P1 |
| Tailscale tunnel | Medium | Low | P1 |
| ngrok tunnel | Medium | Low | P1 |
| Codespaces integration | Medium | Medium | P2 |
| Mobile remote control | Medium | High | P2 |
| E2E encryption | Low | High | P3 |

---

## Security Considerations

### SSH Key Management

```typescript
// Use system SSH agent, don't manage keys directly
interface SSHConfig {
  host: string;
  port?: number;
  username?: string;
  // Don't store private keys - use SSH agent
  useAgent?: boolean;  // Default: true
  identityFile?: string; // Path only, not content
}
```

### Container Isolation

- Run containers with limited privileges (no `--privileged`)
- Use ephemeral SSH keys per container session
- Clean up containers on workspace close
- Limit network access (only expose necessary ports)

### Tunnel Security

- Prefer Tailscale ACLs for team environments
- Enable authentication for public tunnels (ngrok OAuth)
- Use Cloudflare Access for enterprise requirements
- Never expose unauthenticated endpoints

---

## Conclusion

Superset should implement a **hybrid remote execution architecture** that:

1. **Abstracts runtime complexity** - Unified interface for local, container, and SSH
2. **Leverages best SSH patterns** - Connection pooling from Mux, dual timeouts
3. **Supports containers** - Docker with SSH inside (Catnip pattern)
4. **Enables easy remote access** - Multi-provider tunnels (VibeTunnel pattern)
5. **Optionally adds mobile control** - WebSocket relay with E2E (Happy pattern)

The key insight is that **these approaches are complementary, not competing**:
- SSH runtime for existing infrastructure
- Containers for isolation and reproducibility
- Tunnels for NAT traversal and easy sharing
- Mobile for on-the-go monitoring and control

By implementing this architecture, Superset can offer the most flexible and powerful remote execution capabilities in the AI coding agent space, while maintaining excellent UX and enterprise-grade security.
