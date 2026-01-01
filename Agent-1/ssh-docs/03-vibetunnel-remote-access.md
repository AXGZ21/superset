# VibeTunnel Remote Access - Deep Technical Analysis

## Overview

VibeTunnel implements a **multi-provider tunnel system** for remote access to Claude Code instances. Rather than traditional SSH execution, it creates secure tunnels using various providers (Tailscale, ngrok, Cloudflare) and a unique "HQ mode" for centralized orchestration.

**Key Files**:
- `src/tunnel/` (tunnel provider implementations)
- `src/hq/` (HQ mode orchestration)
- `src/config/` (configuration management)
- `docs/remote-access.md`

---

## Architecture

### Multi-Provider Tunnel System

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        VIBETUNNEL ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌───────────────┐   ┌───────────────┐   ┌───────────────┐                │
│   │   Tailscale   │   │     ngrok     │   │  Cloudflare   │                │
│   │    Tunnel     │   │    Tunnel     │   │    Tunnel     │                │
│   ├───────────────┤   ├───────────────┤   ├───────────────┤                │
│   │ Zero-config   │   │ Quick setup   │   │ Workers/Edge  │                │
│   │ WireGuard     │   │ Public URLs   │   │ Zero Trust    │                │
│   │ Mesh network  │   │ Auth tokens   │   │ Access        │                │
│   └───────────────┘   └───────────────┘   └───────────────┘                │
│           │                   │                   │                         │
│           └───────────────────┼───────────────────┘                         │
│                               ▼                                             │
│                    ┌─────────────────────┐                                  │
│                    │  Tunnel Manager     │                                  │
│                    │  Provider Registry  │                                  │
│                    │  Health Monitoring  │                                  │
│                    └─────────────────────┘                                  │
│                               │                                             │
│              ┌────────────────┼────────────────┐                           │
│              ▼                ▼                ▼                            │
│       ┌──────────┐    ┌──────────┐    ┌──────────┐                        │
│       │  Local   │    │  Remote  │    │   HQ     │                        │
│       │  Agent   │    │  Agent   │    │  Mode    │                        │
│       └──────────┘    └──────────┘    └──────────┘                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Provider Interface

```typescript
interface TunnelProvider {
  name: string;
  isInstalled(): Promise<boolean>;
  isAuthenticated(): Promise<boolean>;
  startTunnel(options: TunnelOptions): Promise<TunnelConnection>;
  stopTunnel(connectionId: string): Promise<void>;
  getStatus(): Promise<TunnelStatus>;
}

interface TunnelOptions {
  localPort: number;
  subdomain?: string;          // ngrok/cloudflare
  authRequired?: boolean;      // Enable authentication
  allowedUsers?: string[];     // Whitelist (Tailscale/Cloudflare)
}

interface TunnelConnection {
  id: string;
  provider: string;
  publicUrl: string;
  localPort: number;
  status: 'connecting' | 'connected' | 'error';
  startedAt: Date;
  metrics?: ConnectionMetrics;
}
```

---

## Tailscale Integration

### Zero-Config Mesh Networking

VibeTunnel's Tailscale integration provides the most seamless remote access:

```typescript
class TailscaleTunnel implements TunnelProvider {
  name = 'tailscale';

  async isInstalled(): Promise<boolean> {
    try {
      await exec('tailscale version');
      return true;
    } catch {
      return false;
    }
  }

  async isAuthenticated(): Promise<boolean> {
    const { stdout } = await exec('tailscale status --json');
    const status = JSON.parse(stdout);
    return status.BackendState === 'Running' && status.Self?.Online;
  }

  async startTunnel(options: TunnelOptions): Promise<TunnelConnection> {
    // Enable Tailscale funnel for public access
    // or use Tailscale Serve for mesh-only access

    if (options.publicAccess) {
      // Funnel: Public HTTPS access
      await exec(`tailscale funnel ${options.localPort}`);
      const hostname = await this.getHostname();
      return {
        publicUrl: `https://${hostname}`,
        ...
      };
    } else {
      // Serve: Tailnet-only access
      await exec(`tailscale serve ${options.localPort}`);
      const hostname = await this.getMachineHostname();
      return {
        publicUrl: `http://${hostname}:${options.localPort}`,
        ...
      };
    }
  }

  async getMachineHostname(): Promise<string> {
    const { stdout } = await exec('tailscale status --json');
    const status = JSON.parse(stdout);
    return `${status.Self.DNSName}.ts.net`;
  }
}
```

### ACL-Based Access Control

```typescript
interface TailscaleACL {
  // Define who can access the Claude Code instance
  acls: ACLRule[];
  // Tag-based access for team environments
  tagOwners: Record<string, string[]>;
}

// Example ACL for Claude Code access
const claudeCodeACL: TailscaleACL = {
  acls: [
    {
      action: 'accept',
      src: ['tag:developers'],
      dst: ['tag:claude-code:*'],
    },
  ],
  tagOwners: {
    'tag:developers': ['group:engineering'],
    'tag:claude-code': ['autogroup:admin'],
  },
};
```

### Benefits

1. **Zero-config**: No port forwarding, NAT traversal, or firewall rules
2. **End-to-end encryption**: WireGuard-based
3. **ACL control**: Fine-grained access policies
4. **Stable DNS**: `machine.user.ts.net` always reachable
5. **Cross-platform**: Works on any device with Tailscale

---

## ngrok Integration

### Quick Public URL Generation

```typescript
class NgrokTunnel implements TunnelProvider {
  name = 'ngrok';
  private activeProcesses: Map<string, ChildProcess> = new Map();

  async isInstalled(): Promise<boolean> {
    try {
      await exec('ngrok version');
      return true;
    } catch {
      return false;
    }
  }

  async isAuthenticated(): Promise<boolean> {
    const configPath = this.getConfigPath();
    if (!existsSync(configPath)) return false;

    const config = YAML.parse(readFileSync(configPath, 'utf-8'));
    return !!config.authtoken;
  }

  async startTunnel(options: TunnelOptions): Promise<TunnelConnection> {
    const args = ['http', options.localPort.toString()];

    if (options.subdomain) {
      args.push('--subdomain', options.subdomain);
    }

    if (options.authRequired) {
      // Add HTTP basic auth
      args.push('--basic-auth', `${options.username}:${options.password}`);
    }

    // Start ngrok process
    const proc = spawn('ngrok', args);
    const connectionId = randomUUID();
    this.activeProcesses.set(connectionId, proc);

    // Parse output for public URL
    const publicUrl = await this.waitForUrl(proc);

    return {
      id: connectionId,
      provider: 'ngrok',
      publicUrl,
      localPort: options.localPort,
      status: 'connected',
      startedAt: new Date(),
    };
  }

  private async waitForUrl(proc: ChildProcess): Promise<string> {
    // ngrok exposes local API at 127.0.0.1:4040
    await sleep(2000); // Wait for startup

    const response = await fetch('http://127.0.0.1:4040/api/tunnels');
    const data = await response.json();

    return data.tunnels[0]?.public_url;
  }

  async stopTunnel(connectionId: string): Promise<void> {
    const proc = this.activeProcesses.get(connectionId);
    if (proc) {
      proc.kill('SIGTERM');
      this.activeProcesses.delete(connectionId);
    }
  }
}
```

### OAuth/OIDC Integration

```typescript
interface NgrokAuthConfig {
  // OAuth providers for access control
  oauth?: {
    provider: 'google' | 'github' | 'microsoft';
    allowEmails?: string[];
    allowDomains?: string[];
  };
  // OIDC for enterprise SSO
  oidc?: {
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
    allowedGroups?: string[];
  };
}

// Start tunnel with OAuth
async startWithOAuth(options: TunnelOptions & NgrokAuthConfig): Promise<TunnelConnection> {
  const args = ['http', options.localPort.toString()];

  if (options.oauth) {
    args.push('--oauth', options.oauth.provider);
    if (options.oauth.allowDomains) {
      args.push('--oauth-allow-domain', options.oauth.allowDomains.join(','));
    }
  }

  // ... rest of implementation
}
```

---

## Cloudflare Tunnel Integration

### Zero Trust Access

```typescript
class CloudflareTunnel implements TunnelProvider {
  name = 'cloudflare';

  async startTunnel(options: TunnelOptions): Promise<TunnelConnection> {
    // Quick tunnel (no account required)
    if (!options.persistentTunnel) {
      const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${options.localPort}`]);
      const url = await this.parseQuickTunnelUrl(proc);
      return { publicUrl: url, ... };
    }

    // Named tunnel (with Cloudflare account)
    const tunnelName = options.tunnelName || 'claude-code';

    // Create tunnel if not exists
    await exec(`cloudflared tunnel create ${tunnelName}`);

    // Configure ingress rules
    await this.writeConfig(tunnelName, options);

    // Run tunnel
    const proc = spawn('cloudflared', ['tunnel', 'run', tunnelName]);

    return {
      publicUrl: `https://${tunnelName}.${options.domain}`,
      ...
    };
  }

  private async writeConfig(tunnelName: string, options: TunnelOptions): Promise<void> {
    const config = {
      tunnel: tunnelName,
      credentials_file: `~/.cloudflared/${tunnelName}.json`,
      ingress: [
        {
          hostname: `${tunnelName}.${options.domain}`,
          service: `http://localhost:${options.localPort}`,
        },
        { service: 'http_status:404' }, // Catch-all
      ],
    };

    writeFileSync(`~/.cloudflared/${tunnelName}.yml`, YAML.stringify(config));
  }
}
```

### Cloudflare Access Integration

```typescript
interface CloudflareAccessConfig {
  // Application-level access policies
  accessPolicy: {
    name: string;
    decision: 'allow' | 'deny';
    include: AccessRule[];
    exclude?: AccessRule[];
  };
}

interface AccessRule {
  // Various rule types
  email?: { email: string };
  emailDomain?: { domain: string };
  everyone?: {};
  ip?: { ip: string };
  geo?: { country_code: string };
  group?: { id: string };
  serviceToken?: { token_id: string };
}

// Create access application
async createAccessApplication(config: CloudflareAccessConfig): Promise<void> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/access/apps`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Claude Code Remote',
        domain: `claude-code.${this.domain}`,
        type: 'self_hosted',
        session_duration: '24h',
        policies: [config.accessPolicy],
      }),
    }
  );
}
```

---

## HQ Mode - Centralized Orchestration

### Architecture

HQ mode enables a single "headquarters" machine to orchestrate multiple remote Claude Code instances:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              HQ MODE                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                         ┌─────────────┐                                     │
│                         │  HQ Server  │                                     │
│                         │  Dashboard  │                                     │
│                         │  Task Queue │                                     │
│                         └──────┬──────┘                                     │
│                                │                                             │
│              ┌─────────────────┼─────────────────┐                          │
│              │                 │                 │                           │
│              ▼                 ▼                 ▼                           │
│       ┌──────────┐      ┌──────────┐      ┌──────────┐                     │
│       │ Agent 1  │      │ Agent 2  │      │ Agent 3  │                     │
│       │ Tailscale│      │  ngrok   │      │ Cloudflare│                    │
│       │ *.ts.net │      │ *.ngrok  │      │ *.cf     │                     │
│       └──────────┘      └──────────┘      └──────────┘                     │
│                                                                              │
│   Features:                                                                  │
│   - Centralized task distribution                                           │
│   - Real-time status monitoring                                             │
│   - Session aggregation                                                      │
│   - Cross-agent communication                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### HQ Server Implementation

```typescript
interface HQServer {
  agents: Map<string, RemoteAgent>;
  taskQueue: TaskQueue;
  dashboard: Dashboard;
}

interface RemoteAgent {
  id: string;
  name: string;
  tunnelUrl: string;
  tunnelProvider: string;
  status: 'online' | 'offline' | 'busy';
  currentTask?: string;
  lastSeen: Date;
  metrics: AgentMetrics;
}

interface AgentMetrics {
  tasksCompleted: number;
  tokensUsed: number;
  uptime: number;
  avgResponseTime: number;
}

class HQServer {
  private agents: Map<string, RemoteAgent> = new Map();
  private taskQueue: TaskQueue;
  private wsServer: WebSocketServer;

  async start(port: number): Promise<void> {
    // Start WebSocket server for agent connections
    this.wsServer = new WebSocketServer({ port });

    this.wsServer.on('connection', (ws, req) => {
      this.handleAgentConnection(ws, req);
    });

    // Start HTTP dashboard
    this.startDashboard(port + 1);
  }

  private handleAgentConnection(ws: WebSocket, req: IncomingMessage): void {
    const agentId = req.headers['x-agent-id'] as string;

    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'register':
          this.registerAgent(agentId, message.payload, ws);
          break;
        case 'status':
          this.updateAgentStatus(agentId, message.payload);
          break;
        case 'task-complete':
          this.handleTaskComplete(agentId, message.payload);
          break;
        case 'heartbeat':
          this.updateLastSeen(agentId);
          break;
      }
    });

    ws.on('close', () => {
      this.markAgentOffline(agentId);
    });
  }

  async distributeTask(task: Task): Promise<string> {
    // Find available agent
    const agent = this.findAvailableAgent(task.requirements);

    if (!agent) {
      // Queue task for later
      return this.taskQueue.enqueue(task);
    }

    // Send task to agent
    await this.sendToAgent(agent.id, {
      type: 'task',
      payload: task,
    });

    return agent.id;
  }

  private findAvailableAgent(requirements?: TaskRequirements): RemoteAgent | null {
    for (const [id, agent] of this.agents) {
      if (agent.status !== 'online') continue;

      if (requirements) {
        // Check if agent meets requirements
        if (requirements.minMemory && agent.metrics.availableMemory < requirements.minMemory) {
          continue;
        }
        // ... other requirement checks
      }

      return agent;
    }
    return null;
  }
}
```

### Agent Registration Protocol

```typescript
interface AgentRegistration {
  id: string;
  name: string;
  tunnelInfo: {
    provider: string;
    url: string;
    authMethod?: 'none' | 'token' | 'oauth';
  };
  capabilities: {
    maxConcurrentTasks: number;
    supportedLanguages: string[];
    availableTools: string[];
    systemInfo: {
      os: string;
      arch: string;
      memory: number;
      cpuCores: number;
    };
  };
}

class AgentClient {
  private hqUrl: string;
  private ws: WebSocket;
  private heartbeatInterval: NodeJS.Timer;

  async connect(hqUrl: string): Promise<void> {
    this.hqUrl = hqUrl;

    this.ws = new WebSocket(hqUrl, {
      headers: {
        'x-agent-id': this.agentId,
      },
    });

    await this.waitForConnection();

    // Register with HQ
    this.send({
      type: 'register',
      payload: await this.getRegistrationInfo(),
    });

    // Start heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.send({ type: 'heartbeat' });
    }, 30000);

    // Handle incoming messages
    this.ws.on('message', (data) => {
      this.handleMessage(JSON.parse(data.toString()));
    });
  }

  private handleMessage(message: any): void {
    switch (message.type) {
      case 'task':
        this.executeTask(message.payload);
        break;
      case 'cancel':
        this.cancelTask(message.payload.taskId);
        break;
      case 'query':
        this.respondToQuery(message.payload);
        break;
    }
  }

  private async executeTask(task: Task): Promise<void> {
    // Update status
    this.send({
      type: 'status',
      payload: { status: 'busy', currentTask: task.id },
    });

    try {
      // Execute Claude Code with task
      const result = await this.claudeCode.execute(task.prompt, {
        workingDir: task.workingDir,
        timeout: task.timeout,
      });

      // Report completion
      this.send({
        type: 'task-complete',
        payload: {
          taskId: task.id,
          success: true,
          result,
        },
      });
    } catch (error) {
      this.send({
        type: 'task-complete',
        payload: {
          taskId: task.id,
          success: false,
          error: error.message,
        },
      });
    }

    // Update status back to online
    this.send({
      type: 'status',
      payload: { status: 'online', currentTask: null },
    });
  }
}
```

---

## Health Monitoring

### Multi-Provider Health Checks

```typescript
class TunnelHealthMonitor {
  private tunnels: Map<string, TunnelConnection> = new Map();
  private healthCheckInterval: NodeJS.Timer;

  start(): void {
    this.healthCheckInterval = setInterval(() => {
      this.checkAllTunnels();
    }, 30000); // Every 30 seconds
  }

  private async checkAllTunnels(): Promise<void> {
    for (const [id, tunnel] of this.tunnels) {
      try {
        const healthy = await this.checkTunnel(tunnel);

        if (!healthy) {
          this.emit('tunnel:unhealthy', tunnel);
          await this.attemptRecovery(tunnel);
        }
      } catch (error) {
        this.emit('tunnel:error', { tunnel, error });
      }
    }
  }

  private async checkTunnel(tunnel: TunnelConnection): Promise<boolean> {
    switch (tunnel.provider) {
      case 'tailscale':
        return this.checkTailscale(tunnel);
      case 'ngrok':
        return this.checkNgrok(tunnel);
      case 'cloudflare':
        return this.checkCloudflare(tunnel);
      default:
        return false;
    }
  }

  private async checkTailscale(tunnel: TunnelConnection): Promise<boolean> {
    try {
      const { stdout } = await exec('tailscale status --json');
      const status = JSON.parse(stdout);
      return status.BackendState === 'Running' && status.Self?.Online;
    } catch {
      return false;
    }
  }

  private async checkNgrok(tunnel: TunnelConnection): Promise<boolean> {
    try {
      const response = await fetch('http://127.0.0.1:4040/api/tunnels');
      const data = await response.json();
      return data.tunnels.some((t: any) => t.public_url === tunnel.publicUrl);
    } catch {
      return false;
    }
  }

  private async checkCloudflare(tunnel: TunnelConnection): Promise<boolean> {
    try {
      const response = await fetch(tunnel.publicUrl, { method: 'HEAD' });
      return response.status < 500;
    } catch {
      return false;
    }
  }

  private async attemptRecovery(tunnel: TunnelConnection): Promise<void> {
    this.emit('tunnel:recovering', tunnel);

    // Stop existing tunnel
    const provider = this.getProvider(tunnel.provider);
    await provider.stopTunnel(tunnel.id);

    // Wait before retry
    await sleep(5000);

    // Restart tunnel
    const newTunnel = await provider.startTunnel({
      localPort: tunnel.localPort,
      ...tunnel.options,
    });

    this.tunnels.set(tunnel.id, newTunnel);
    this.emit('tunnel:recovered', newTunnel);
  }
}
```

---

## Security Model

### Authentication Flow

```typescript
interface TunnelAuth {
  // Provider-specific authentication
  tailscale?: {
    // ACL-based, managed by Tailscale admin
    aclTags: string[];
  };
  ngrok?: {
    // Basic auth or OAuth
    basicAuth?: { username: string; password: string };
    oauth?: NgrokOAuthConfig;
  };
  cloudflare?: {
    // Zero Trust Access
    accessPolicies: AccessPolicy[];
  };
}

// Authentication middleware for local server
function createAuthMiddleware(config: TunnelAuth): RequestHandler {
  return async (req, res, next) => {
    // Check Tailscale authenticated connection
    if (config.tailscale && isTailscaleRequest(req)) {
      // Tailscale handles auth via ACL
      return next();
    }

    // Check ngrok authenticated headers
    if (config.ngrok?.oauth && req.headers['ngrok-auth-user-email']) {
      req.user = {
        email: req.headers['ngrok-auth-user-email'],
        provider: 'ngrok-oauth',
      };
      return next();
    }

    // Check Cloudflare Access headers
    if (config.cloudflare && req.headers['cf-access-authenticated-user-email']) {
      req.user = {
        email: req.headers['cf-access-authenticated-user-email'],
        provider: 'cloudflare-access',
      };
      return next();
    }

    // Basic auth fallback
    if (config.ngrok?.basicAuth) {
      const auth = basicAuth(req);
      if (auth && auth.name === config.ngrok.basicAuth.username &&
          auth.pass === config.ngrok.basicAuth.password) {
        return next();
      }
    }

    res.status(401).send('Unauthorized');
  };
}
```

### End-to-End Encryption

```typescript
// Additional E2E encryption layer (beyond tunnel encryption)
class E2EEncryption {
  private keyPair: CryptoKeyPair;
  private peerPublicKey?: CryptoKey;

  async generateKeyPair(): Promise<void> {
    this.keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-384' },
      true,
      ['deriveKey']
    );
  }

  async deriveSharedKey(peerPublicKey: CryptoKey): Promise<CryptoKey> {
    this.peerPublicKey = peerPublicKey;

    return await crypto.subtle.deriveKey(
      { name: 'ECDH', public: peerPublicKey },
      this.keyPair.privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async encrypt(data: string, sharedKey: CryptoKey): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(data);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      sharedKey,
      encoded
    );

    // Combine IV + ciphertext
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return btoa(String.fromCharCode(...combined));
  }
}
```

---

## UX Considerations

### Provider Selection UI

```typescript
interface TunnelSetupWizard {
  steps: [
    'detect-providers',    // Auto-detect installed providers
    'select-provider',     // User chooses provider
    'configure-auth',      // Provider-specific auth setup
    'test-connection',     // Verify tunnel works
    'generate-url',        // Show connection URL/instructions
  ];
}

// Auto-detection
async function detectInstalledProviders(): Promise<ProviderStatus[]> {
  const results: ProviderStatus[] = [];

  for (const provider of ['tailscale', 'ngrok', 'cloudflare']) {
    const tunnel = getProvider(provider);

    results.push({
      name: provider,
      installed: await tunnel.isInstalled(),
      authenticated: await tunnel.isAuthenticated(),
      recommended: provider === 'tailscale', // Best for teams
    });
  }

  return results;
}
```

### Quick Connect Flow

```
1. User runs: vibetunnel connect
2. Auto-detect: Found Tailscale (authenticated)
3. Start tunnel: Exposing port 3000
4. Output: https://machine-name.user.ts.net
5. Share: "Run this on remote machine: vibetunnel join https://..."
```

### Status Display

```
┌─────────────────────────────────────────────────────────────────┐
│  VibeTunnel Status                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Provider: Tailscale                                            │
│  Status: Connected                                               │
│  URL: https://dev-machine.user.ts.net                           │
│  Uptime: 2h 34m                                                  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Connected Clients                                        │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │  laptop.user.ts.net     Online   Last: 2m ago            │  │
│  │  phone.user.ts.net      Online   Last: 5m ago            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [Disconnect] [Copy URL] [View Logs]                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Error Handling

### Provider-Specific Recovery

| Provider | Error | Recovery Action |
|----------|-------|-----------------|
| Tailscale | Not authenticated | Run `tailscale login` |
| Tailscale | Funnel not enabled | Run `tailscale funnel --bg` |
| ngrok | Auth token invalid | Update token in config |
| ngrok | Tunnel limit reached | Upgrade plan or stop other tunnels |
| Cloudflare | Tunnel not found | Create tunnel first |
| Cloudflare | DNS not configured | Add CNAME record |

### Automatic Failover

```typescript
class TunnelFailover {
  private providers: TunnelProvider[];
  private currentProvider: number = 0;

  async startWithFailover(options: TunnelOptions): Promise<TunnelConnection> {
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[(this.currentProvider + i) % this.providers.length];

      try {
        if (!await provider.isInstalled()) continue;
        if (!await provider.isAuthenticated()) continue;

        const connection = await provider.startTunnel(options);
        this.currentProvider = (this.currentProvider + i) % this.providers.length;
        return connection;
      } catch (error) {
        console.warn(`Provider ${provider.name} failed:`, error.message);
      }
    }

    throw new Error('All tunnel providers failed');
  }
}
```

---

## Key Patterns for Superset

1. **Multi-provider abstraction** - Support multiple tunnel providers with unified interface
2. **Auto-detection** - Detect installed providers and guide setup
3. **Zero-config options** - Tailscale for teams, ngrok quick tunnels for individuals
4. **Health monitoring** - Continuous tunnel health checks with auto-recovery
5. **HQ mode** - Centralized orchestration of multiple remote agents
6. **Authentication layers** - Provider-native auth plus optional E2E encryption
7. **Graceful failover** - Automatic switch to backup providers on failure
