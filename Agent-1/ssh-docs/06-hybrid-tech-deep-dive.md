# Hybrid Architecture Technical Deep Dive

## Overview

This document provides implementation-level detail for building Superset's hybrid runtime architecture: Local, Cloud, and SSH. It synthesizes the best patterns from analyzed competitors while applying rigorous software engineering principles.

---

## Table of Contents

1. [Core Abstractions](#1-core-abstractions)
2. [Local Runtime](#2-local-runtime)
3. [SSH Runtime](#3-ssh-runtime)
4. [Cloud Runtime](#4-cloud-runtime)
5. [Git Synchronization](#5-git-synchronization)
6. [Terminal Streaming](#6-terminal-streaming)
7. [Workspace State & Migration](#7-workspace-state--migration)
8. [Security Architecture](#8-security-architecture)
9. [Observability & Reliability](#9-observability--reliability)
10. [Infrastructure Decisions](#10-infrastructure-decisions)

---

## 1. Core Abstractions

### 1.1 Runtime Interface

The foundation is a clean abstraction that hides runtime differences from the rest of the application.

```typescript
// packages/runtime/src/types.ts

/**
 * Core runtime interface - all execution environments implement this.
 * Design principle: If it's not in this interface, the UI shouldn't need it.
 */
export interface Runtime {
  readonly id: string;
  readonly type: RuntimeType;
  readonly status: RuntimeStatus;

  // Lifecycle
  initialize(): Promise<void>;
  dispose(): Promise<void>;

  // Health
  healthCheck(): Promise<HealthCheckResult>;
  onStatusChange(callback: (status: RuntimeStatus) => void): Unsubscribe;

  // Execution
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  spawn(command: string, options?: SpawnOptions): Promise<ProcessHandle>;

  // File System
  fs: RuntimeFileSystem;

  // Terminal
  createTerminal(options?: TerminalOptions): Promise<Terminal>;

  // State (for migration)
  captureState(): Promise<RuntimeState>;
  restoreState(state: RuntimeState): Promise<void>;
}

export type RuntimeType = 'local' | 'cloud' | 'ssh';

export type RuntimeStatus =
  | { state: 'initializing' }
  | { state: 'ready' }
  | { state: 'busy'; activeProcesses: number }
  | { state: 'error'; error: Error; recoverable: boolean }
  | { state: 'disconnected'; reason: string }
  | { state: 'disposed' };

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
  // Stream stdout/stderr as they arrive
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
  timedOut: boolean;
}

export interface RuntimeFileSystem {
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, content: Buffer | string): Promise<void>;
  readdir(path: string): Promise<DirEntry[]>;
  stat(path: string): Promise<FileStat>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean }): Promise<void>;
  watch(path: string, callback: (event: FSEvent) => void): Promise<Unsubscribe>;
}
```

### 1.2 Runtime Factory

```typescript
// packages/runtime/src/factory.ts

export interface RuntimeConfig {
  type: 'local';
} | {
  type: 'cloud';
  region?: string;
  size?: 'small' | 'standard' | 'large';
} | {
  type: 'ssh';
  host: string;  // Can be hostname, user@host, or SSH config alias
  port?: number;
  identityFile?: string;
};

export class RuntimeFactory {
  private sshPool: SSHConnectionPool;
  private cloudClient: CloudClient;

  constructor(deps: RuntimeFactoryDeps) {
    this.sshPool = new SSHConnectionPool(deps.sshConfig);
    this.cloudClient = new CloudClient(deps.cloudConfig);
  }

  async create(config: RuntimeConfig, workspaceId: string): Promise<Runtime> {
    switch (config.type) {
      case 'local':
        return new LocalRuntime(workspaceId);

      case 'ssh':
        const connection = await this.sshPool.acquire(config);
        return new SSHRuntime(workspaceId, connection, this.sshPool);

      case 'cloud':
        const worker = await this.cloudClient.acquireWorker(config);
        return new CloudRuntime(workspaceId, worker, this.cloudClient);

      default:
        throw new Error(`Unknown runtime type: ${(config as any).type}`);
    }
  }

  // Detect available runtimes for UI
  async detectAvailable(): Promise<AvailableRuntime[]> {
    const results: AvailableRuntime[] = [
      { type: 'local', available: true, name: 'Local' },
    ];

    // Check cloud availability
    try {
      const cloudStatus = await this.cloudClient.getStatus();
      results.push({
        type: 'cloud',
        available: cloudStatus.authenticated,
        name: 'Superset Cloud',
        details: cloudStatus.authenticated
          ? `${cloudStatus.availableWorkers} workers available`
          : 'Sign in to enable',
      });
    } catch {
      results.push({ type: 'cloud', available: false, name: 'Superset Cloud' });
    }

    // Check configured SSH hosts
    const sshHosts = await this.sshPool.getConfiguredHosts();
    for (const host of sshHosts) {
      const health = await this.sshPool.checkHealth(host);
      results.push({
        type: 'ssh',
        available: health.status === 'healthy',
        name: host.name,
        details: health.status === 'healthy'
          ? `${host.user}@${host.hostname}`
          : health.error,
      });
    }

    return results;
  }
}
```

### 1.3 Process Handle Abstraction

```typescript
// packages/runtime/src/process.ts

/**
 * Unified process handle that works across all runtimes.
 * Abstracts node-pty (local), SSH exec (SSH), and WebSocket (cloud).
 */
export interface ProcessHandle {
  readonly pid: number | string;  // String for cloud (worker-assigned ID)
  readonly running: boolean;

  // I/O
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly stdin: WritableStream<Uint8Array>;

  // Control
  kill(signal?: string): Promise<void>;
  wait(): Promise<ExecResult>;

  // Events
  onExit(callback: (result: ExecResult) => void): Unsubscribe;
}

/**
 * Terminal is a special ProcessHandle with PTY semantics.
 */
export interface Terminal extends ProcessHandle {
  resize(cols: number, rows: number): Promise<void>;

  // Terminal-specific: combined output stream (stdout + stderr interleaved)
  readonly output: ReadableStream<Uint8Array>;

  // For state capture
  getScrollback(): Promise<string>;
}
```

---

## 2. Local Runtime

The local runtime is the simplest—direct execution on the user's machine.

### 2.1 Implementation

```typescript
// packages/runtime/src/local/LocalRuntime.ts

import * as pty from 'node-pty';
import { spawn, exec as execCb } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { watch } from 'chokidar';

const execAsync = promisify(execCb);

export class LocalRuntime implements Runtime {
  readonly type = 'local' as const;
  private statusListeners = new Set<(status: RuntimeStatus) => void>();
  private _status: RuntimeStatus = { state: 'initializing' };
  private activeProcesses = new Map<string, ProcessHandle>();

  constructor(
    readonly id: string,
    private workingDir: string = process.cwd()
  ) {}

  async initialize(): Promise<void> {
    // Verify working directory exists
    const stat = await fs.stat(this.workingDir);
    if (!stat.isDirectory()) {
      throw new Error(`Working directory is not a directory: ${this.workingDir}`);
    }
    this.setStatus({ state: 'ready' });
  }

  async dispose(): Promise<void> {
    // Kill all active processes
    for (const [id, proc] of this.activeProcesses) {
      await proc.kill('SIGTERM');
    }
    this.activeProcesses.clear();
    this.setStatus({ state: 'disposed' });
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return {
      healthy: true,
      latency: 0,
      details: { type: 'local' },
    };
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const cwd = options.cwd
      ? path.resolve(this.workingDir, options.cwd)
      : this.workingDir;

    const controller = new AbortController();
    const timeout = options.timeout ?? 120_000;

    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Merge abort signals
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        env: { ...process.env, ...options.env },
        signal: controller.signal,
        maxBuffer: 50 * 1024 * 1024, // 50MB
      });

      return {
        stdout,
        stderr,
        exitCode: 0,
        timedOut: false,
      };
    } catch (error: any) {
      if (error.killed && controller.signal.aborted) {
        return {
          stdout: error.stdout ?? '',
          stderr: error.stderr ?? '',
          exitCode: 124,
          timedOut: true,
        };
      }

      return {
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? '',
        exitCode: error.code ?? 1,
        signal: error.signal,
        timedOut: false,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async spawn(command: string, options: SpawnOptions = {}): Promise<ProcessHandle> {
    const cwd = options.cwd
      ? path.resolve(this.workingDir, options.cwd)
      : this.workingDir;

    const [cmd, ...args] = this.parseCommand(command);

    const proc = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const handle = new LocalProcessHandle(proc);
    const id = `local-${proc.pid}`;
    this.activeProcesses.set(id, handle);

    handle.onExit(() => {
      this.activeProcesses.delete(id);
      this.updateBusyStatus();
    });

    this.updateBusyStatus();
    return handle;
  }

  async createTerminal(options: TerminalOptions = {}): Promise<Terminal> {
    const cwd = options.cwd
      ? path.resolve(this.workingDir, options.cwd)
      : this.workingDir;

    const shell = options.shell ?? process.env.SHELL ?? '/bin/bash';

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      cwd,
      env: {
        ...process.env,
        ...options.env,
        TERM: 'xterm-256color',
      },
    });

    return new LocalTerminal(ptyProcess);
  }

  // File system implementation
  fs: RuntimeFileSystem = {
    readFile: (p) => fs.readFile(this.resolvePath(p)),
    writeFile: (p, content) => fs.writeFile(this.resolvePath(p), content),
    readdir: async (p) => {
      const entries = await fs.readdir(this.resolvePath(p), { withFileTypes: true });
      return entries.map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
        isSymlink: e.isSymbolicLink(),
      }));
    },
    stat: async (p) => {
      const s = await fs.stat(this.resolvePath(p));
      return {
        size: s.size,
        mtime: s.mtime,
        isDirectory: s.isDirectory(),
        isFile: s.isFile(),
        mode: s.mode,
      };
    },
    exists: async (p) => {
      try {
        await fs.access(this.resolvePath(p));
        return true;
      } catch {
        return false;
      }
    },
    mkdir: (p, opts) => fs.mkdir(this.resolvePath(p), opts),
    rm: (p, opts) => fs.rm(this.resolvePath(p), opts),
    watch: async (p, callback) => {
      const watcher = watch(this.resolvePath(p), {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 100 },
      });

      watcher.on('all', (event, filePath) => {
        callback({ type: event as any, path: filePath });
      });

      return () => watcher.close();
    },
  };

  async captureState(): Promise<RuntimeState> {
    return {
      type: 'local',
      workingDir: this.workingDir,
      // Local state is just the filesystem - nothing to capture
    };
  }

  async restoreState(state: RuntimeState): Promise<void> {
    if (state.type !== 'local') {
      throw new Error(`Cannot restore ${state.type} state to local runtime`);
    }
    // Nothing to restore for local - filesystem is already there
  }

  // Private helpers

  private resolvePath(p: string): string {
    return path.resolve(this.workingDir, p);
  }

  private parseCommand(command: string): string[] {
    // Simple shell-style parsing
    // For complex cases, we'd use a proper parser
    return ['sh', '-c', command];
  }

  private setStatus(status: RuntimeStatus): void {
    this._status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private updateBusyStatus(): void {
    if (this.activeProcesses.size > 0) {
      this.setStatus({ state: 'busy', activeProcesses: this.activeProcesses.size });
    } else {
      this.setStatus({ state: 'ready' });
    }
  }

  get status(): RuntimeStatus {
    return this._status;
  }

  onStatusChange(callback: (status: RuntimeStatus) => void): Unsubscribe {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }
}
```

### 2.2 Local Terminal Implementation

```typescript
// packages/runtime/src/local/LocalTerminal.ts

import type { IPty } from 'node-pty';

export class LocalTerminal implements Terminal {
  private outputBuffer: string[] = [];
  private exitCallbacks = new Set<(result: ExecResult) => void>();
  private _running = true;

  constructor(private pty: IPty) {
    // Capture all output for scrollback
    this.pty.onData((data) => {
      this.outputBuffer.push(data);
      // Keep last 10000 lines approximately
      if (this.outputBuffer.length > 10000) {
        this.outputBuffer = this.outputBuffer.slice(-5000);
      }
    });

    this.pty.onExit(({ exitCode, signal }) => {
      this._running = false;
      const result: ExecResult = {
        stdout: '',
        stderr: '',
        exitCode: exitCode ?? 0,
        signal: signal !== undefined ? String(signal) : undefined,
        timedOut: false,
      };
      for (const cb of this.exitCallbacks) {
        cb(result);
      }
    });
  }

  get pid(): number {
    return this.pty.pid;
  }

  get running(): boolean {
    return this._running;
  }

  get stdout(): ReadableStream<Uint8Array> {
    return this.output; // Terminal combines stdout/stderr
  }

  get stderr(): ReadableStream<Uint8Array> {
    return new ReadableStream(); // Empty for terminal
  }

  get stdin(): WritableStream<Uint8Array> {
    return new WritableStream({
      write: (chunk) => {
        this.pty.write(new TextDecoder().decode(chunk));
      },
    });
  }

  get output(): ReadableStream<Uint8Array> {
    const pty = this.pty;
    return new ReadableStream({
      start(controller) {
        pty.onData((data) => {
          controller.enqueue(new TextEncoder().encode(data));
        });
        pty.onExit(() => {
          controller.close();
        });
      },
    });
  }

  async resize(cols: number, rows: number): Promise<void> {
    this.pty.resize(cols, rows);
  }

  async kill(signal = 'SIGTERM'): Promise<void> {
    this.pty.kill(signal as any);
  }

  async wait(): Promise<ExecResult> {
    return new Promise((resolve) => {
      if (!this._running) {
        resolve({
          stdout: '',
          stderr: '',
          exitCode: 0,
          timedOut: false,
        });
        return;
      }
      this.onExit(resolve);
    });
  }

  onExit(callback: (result: ExecResult) => void): Unsubscribe {
    this.exitCallbacks.add(callback);
    return () => this.exitCallbacks.delete(callback);
  }

  async getScrollback(): Promise<string> {
    return this.outputBuffer.join('');
  }
}
```

---

## 3. SSH Runtime

The SSH runtime provides remote execution on user-owned servers. This is the "power user" path.

### 3.1 Connection Pool (Inspired by Mux)

```typescript
// packages/runtime/src/ssh/SSHConnectionPool.ts

import { Client, ConnectConfig } from 'ssh2';
import { readFileSync, existsSync } from 'fs';
import { parse as parseSSHConfig } from 'ssh-config';
import { homedir } from 'os';
import { join } from 'path';

interface PooledConnection {
  client: Client;
  config: SSHConfig;
  health: ConnectionHealth;
  lastUsed: Date;
  activeStreams: number;
}

interface ConnectionHealth {
  status: 'healthy' | 'unhealthy' | 'unknown' | 'probing';
  lastSuccess?: Date;
  lastFailure?: Date;
  lastError?: string;
  consecutiveFailures: number;
  backoffUntil?: Date;
  latency?: number;
}

export class SSHConnectionPool {
  private connections = new Map<string, PooledConnection>();
  private inflightProbes = new Map<string, Promise<void>>();
  private healthCheckInterval: NodeJS.Timer;

  // Configuration
  private readonly HEALTHY_TTL_MS = 15_000;      // Re-probe after 15s
  private readonly MAX_BACKOFF_MS = 10_000;      // Cap backoff at 10s
  private readonly PROBE_TIMEOUT_MS = 5_000;     // Health probe timeout
  private readonly IDLE_TIMEOUT_MS = 60_000;     // Close idle connections
  private readonly MAX_STREAMS_PER_CONN = 10;    // Multiplexing limit

  constructor(private globalConfig: SSHPoolConfig = {}) {
    // Periodic health checks
    this.healthCheckInterval = setInterval(() => {
      this.performPeriodicHealthChecks();
    }, 30_000);
  }

  async acquire(config: SSHConfig): Promise<SSHConnection> {
    const key = this.configKey(config);
    let pooled = this.connections.get(key);

    // Check if existing connection is usable
    if (pooled && this.isUsable(pooled)) {
      pooled.lastUsed = new Date();
      pooled.activeStreams++;
      return new SSHConnection(pooled.client, config, () => {
        pooled!.activeStreams--;
      });
    }

    // Need new connection - but first check health/backoff
    await this.ensureHealthy(config);

    // Create new connection
    const client = await this.connect(config);

    pooled = {
      client,
      config,
      health: { status: 'healthy', lastSuccess: new Date(), consecutiveFailures: 0 },
      lastUsed: new Date(),
      activeStreams: 1,
    };

    this.connections.set(key, pooled);

    // Setup connection event handlers
    client.on('error', (err) => {
      this.reportFailure(config, err);
    });

    client.on('end', () => {
      this.connections.delete(key);
    });

    return new SSHConnection(client, config, () => {
      pooled!.activeStreams--;
    });
  }

  async checkHealth(config: SSHConfig): Promise<ConnectionHealth> {
    const key = this.configKey(config);
    const pooled = this.connections.get(key);

    if (pooled) {
      return pooled.health;
    }

    // No existing connection - probe
    try {
      await this.probe(config);
      return { status: 'healthy', consecutiveFailures: 0 };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        lastError: error.message,
        consecutiveFailures: 1,
      };
    }
  }

  reportSuccess(config: SSHConfig): void {
    const key = this.configKey(config);
    const pooled = this.connections.get(key);

    if (pooled) {
      pooled.health = {
        status: 'healthy',
        lastSuccess: new Date(),
        consecutiveFailures: 0,
      };
    }
  }

  reportFailure(config: SSHConfig, error: Error): void {
    const key = this.configKey(config);
    const pooled = this.connections.get(key);

    const currentHealth = pooled?.health ?? {
      status: 'unknown',
      consecutiveFailures: 0
    };

    const failures = currentHealth.consecutiveFailures + 1;

    // Exponential backoff: 1s, 2s, 4s, 7s, 10s (capped)
    const baseDelay = Math.min(
      1000 * Math.pow(2, failures - 1),
      this.MAX_BACKOFF_MS
    );
    // Add jitter: ±20%
    const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1);
    const backoffMs = baseDelay + jitter;

    const newHealth: ConnectionHealth = {
      status: 'unhealthy',
      lastFailure: new Date(),
      lastError: error.message,
      consecutiveFailures: failures,
      backoffUntil: new Date(Date.now() + backoffMs),
    };

    if (pooled) {
      pooled.health = newHealth;
      // Close bad connection
      pooled.client.end();
      this.connections.delete(key);
    }
  }

  async getConfiguredHosts(): Promise<SSHHostInfo[]> {
    const hosts: SSHHostInfo[] = [];

    // Parse ~/.ssh/config
    const configPath = join(homedir(), '.ssh', 'config');
    if (existsSync(configPath)) {
      const configContent = readFileSync(configPath, 'utf-8');
      const parsed = parseSSHConfig(configContent);

      for (const section of parsed) {
        if (section.type === 1 && section.param === 'Host') {
          const hostPattern = section.value;
          // Skip wildcards
          if (hostPattern.includes('*')) continue;

          const hostname = this.getConfigValue(section, 'HostName') || hostPattern;
          const user = this.getConfigValue(section, 'User') || process.env.USER;
          const port = parseInt(this.getConfigValue(section, 'Port') || '22', 10);

          hosts.push({
            name: hostPattern,
            hostname,
            user: user!,
            port,
          });
        }
      }
    }

    // Add any manually configured hosts from app settings
    // (Would load from app config)

    return hosts;
  }

  async dispose(): Promise<void> {
    clearInterval(this.healthCheckInterval);

    for (const [key, pooled] of this.connections) {
      pooled.client.end();
    }
    this.connections.clear();
  }

  // Private implementation

  private async ensureHealthy(config: SSHConfig): Promise<void> {
    const key = this.configKey(config);
    const pooled = this.connections.get(key);
    const health = pooled?.health;

    // Check backoff
    if (health?.backoffUntil && health.backoffUntil > new Date()) {
      throw new Error(
        `Connection in backoff until ${health.backoffUntil.toISOString()}: ${health.lastError}`
      );
    }

    // Check if we have fresh healthy status
    if (health?.status === 'healthy' && health.lastSuccess) {
      const age = Date.now() - health.lastSuccess.getTime();
      if (age < this.HEALTHY_TTL_MS) {
        return; // Recent success, skip probe
      }
    }

    // Need to probe - use singleflight pattern
    let probe = this.inflightProbes.get(key);
    if (!probe) {
      probe = this.probe(config);
      this.inflightProbes.set(key, probe);
      probe.finally(() => this.inflightProbes.delete(key));
    }

    await probe;
  }

  private async probe(config: SSHConfig): Promise<void> {
    const startTime = Date.now();

    const client = new Client();

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.end();
          reject(new Error('Connection timeout'));
        }, this.PROBE_TIMEOUT_MS);

        client.on('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        client.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        client.connect(this.buildConnectConfig(config));
      });

      // Quick command to verify shell access
      await new Promise<void>((resolve, reject) => {
        client.exec('echo ok', (err, stream) => {
          if (err) return reject(err);
          stream.on('close', () => resolve());
          stream.on('error', reject);
        });
      });

      const latency = Date.now() - startTime;

      // Update health
      const key = this.configKey(config);
      const pooled = this.connections.get(key);
      if (pooled) {
        pooled.health = {
          status: 'healthy',
          lastSuccess: new Date(),
          consecutiveFailures: 0,
          latency,
        };
      }
    } finally {
      client.end();
    }
  }

  private async connect(config: SSHConfig): Promise<Client> {
    const client = new Client();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.end();
        reject(new Error('Connection timeout'));
      }, 15_000);

      client.on('ready', () => {
        clearTimeout(timeout);
        resolve(client);
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      client.connect(this.buildConnectConfig(config));
    });
  }

  private buildConnectConfig(config: SSHConfig): ConnectConfig {
    const baseConfig: ConnectConfig = {
      host: config.host,
      port: config.port ?? 22,
      username: config.username ?? process.env.USER,
      readyTimeout: 15_000,
      keepaliveInterval: 5_000,
      keepaliveCountMax: 3,
    };

    // Identity file
    if (config.identityFile) {
      baseConfig.privateKey = readFileSync(config.identityFile);
    } else {
      // Try default keys
      const defaultKeys = ['id_ed25519', 'id_rsa', 'id_ecdsa'];
      for (const keyName of defaultKeys) {
        const keyPath = join(homedir(), '.ssh', keyName);
        if (existsSync(keyPath)) {
          baseConfig.privateKey = readFileSync(keyPath);
          break;
        }
      }
    }

    // If no key found, ssh2 will try agent
    if (!baseConfig.privateKey) {
      baseConfig.agent = process.env.SSH_AUTH_SOCK;
    }

    return baseConfig;
  }

  private isUsable(pooled: PooledConnection): boolean {
    return (
      pooled.health.status === 'healthy' &&
      pooled.activeStreams < this.MAX_STREAMS_PER_CONN &&
      pooled.client.writable
    );
  }

  private configKey(config: SSHConfig): string {
    return `${config.username ?? 'default'}@${config.host}:${config.port ?? 22}`;
  }

  private getConfigValue(section: any, key: string): string | undefined {
    const config = section.config?.find((c: any) => c.param === key);
    return config?.value;
  }

  private performPeriodicHealthChecks(): void {
    const now = Date.now();

    for (const [key, pooled] of this.connections) {
      // Close idle connections
      if (pooled.activeStreams === 0) {
        const idleTime = now - pooled.lastUsed.getTime();
        if (idleTime > this.IDLE_TIMEOUT_MS) {
          pooled.client.end();
          this.connections.delete(key);
          continue;
        }
      }

      // Probe unhealthy connections if not in backoff
      if (pooled.health.status === 'unhealthy') {
        if (!pooled.health.backoffUntil || pooled.health.backoffUntil <= new Date()) {
          this.probe(pooled.config).catch(() => {
            // Probe failed, will retry next cycle
          });
        }
      }
    }
  }
}
```

### 3.2 SSH Runtime Implementation

```typescript
// packages/runtime/src/ssh/SSHRuntime.ts

import { Client, SFTPWrapper } from 'ssh2';
import { Readable, Writable } from 'stream';

export class SSHRuntime implements Runtime {
  readonly type = 'ssh' as const;
  private _status: RuntimeStatus = { state: 'initializing' };
  private statusListeners = new Set<(status: RuntimeStatus) => void>();
  private sftp?: SFTPWrapper;
  private activeProcesses = new Map<string, ProcessHandle>();
  private workingDir: string;

  // Environment variables for non-interactive execution
  private readonly NON_INTERACTIVE_ENV = `
export TERM=dumb
export PAGER=cat
export GIT_PAGER=cat
export GIT_TERMINAL_PROMPT=0
export CI=true
`.trim();

  constructor(
    readonly id: string,
    private connection: SSHConnection,
    private pool: SSHConnectionPool,
    config: { workingDir?: string } = {}
  ) {
    this.workingDir = config.workingDir ?? '~';
  }

  async initialize(): Promise<void> {
    try {
      // Get SFTP for file operations
      this.sftp = await this.connection.getSFTP();

      // Verify working directory exists
      await this.exec(`test -d ${this.shellQuote(this.workingDir)}`);

      // Resolve ~ to actual path
      if (this.workingDir.startsWith('~')) {
        const result = await this.exec('echo $HOME');
        const home = result.stdout.trim();
        this.workingDir = this.workingDir.replace('~', home);
      }

      this.setStatus({ state: 'ready' });
    } catch (error: any) {
      this.setStatus({ state: 'error', error, recoverable: true });
      throw error;
    }
  }

  async dispose(): Promise<void> {
    // Kill active processes
    for (const [id, proc] of this.activeProcesses) {
      await proc.kill();
    }
    this.activeProcesses.clear();

    // Release connection back to pool
    this.connection.release();
    this.setStatus({ state: 'disposed' });
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const result = await this.exec('echo ok', { timeout: 5000 });
      const latency = Date.now() - startTime;

      return {
        healthy: result.exitCode === 0,
        latency,
        details: {
          type: 'ssh',
          host: this.connection.config.host,
        },
      };
    } catch (error: any) {
      return {
        healthy: false,
        latency: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const cwd = this.resolvePath(options.cwd);
    const localTimeout = options.timeout ?? 120_000;

    // Dual timeout strategy: remote timeout slightly longer than local
    // This ensures we get proper exit codes instead of abrupt disconnection
    const remoteTimeoutSecs = Math.ceil(localTimeout / 1000) + 1;

    // Build full command with environment setup
    const fullCommand = `
${this.NON_INTERACTIVE_ENV}
cd ${this.shellQuote(cwd)} || exit 1
timeout -s KILL ${remoteTimeoutSecs} bash -c ${this.shellQuote(command)}
`.trim();

    return new Promise((resolve, reject) => {
      const localTimeoutId = setTimeout(() => {
        reject(new Error('Local timeout exceeded'));
      }, localTimeout);

      // Handle abort signal
      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          clearTimeout(localTimeoutId);
          reject(new Error('Aborted'));
        });
      }

      this.connection.client.exec(fullCommand, (err, stream) => {
        if (err) {
          clearTimeout(localTimeoutId);
          this.pool.reportFailure(this.connection.config, err);
          return reject(err);
        }

        let stdout = '';
        let stderr = '';

        stream.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
          options.onStdout?.(chunk);
        });

        stream.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
          options.onStderr?.(chunk);
        });

        stream.on('close', (code: number, signal?: string) => {
          clearTimeout(localTimeoutId);

          // Exit code 255 = SSH error (connection lost, etc.)
          if (code === 255) {
            this.pool.reportFailure(
              this.connection.config,
              new Error('SSH connection error')
            );
          } else {
            this.pool.reportSuccess(this.connection.config);
          }

          resolve({
            stdout,
            stderr,
            exitCode: code ?? 0,
            signal,
            timedOut: code === 124 || code === 137, // timeout or SIGKILL
          });
        });

        stream.on('error', (streamErr: Error) => {
          clearTimeout(localTimeoutId);
          this.pool.reportFailure(this.connection.config, streamErr);
          reject(streamErr);
        });
      });
    });
  }

  async spawn(command: string, options: SpawnOptions = {}): Promise<ProcessHandle> {
    const cwd = this.resolvePath(options.cwd);

    const fullCommand = `
${this.NON_INTERACTIVE_ENV}
cd ${this.shellQuote(cwd)} || exit 1
${command}
`.trim();

    return new Promise((resolve, reject) => {
      this.connection.client.exec(fullCommand, (err, stream) => {
        if (err) return reject(err);

        const handle = new SSHProcessHandle(stream);
        const id = `ssh-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        this.activeProcesses.set(id, handle);
        handle.onExit(() => {
          this.activeProcesses.delete(id);
          this.updateBusyStatus();
        });

        this.updateBusyStatus();
        resolve(handle);
      });
    });
  }

  async createTerminal(options: TerminalOptions = {}): Promise<Terminal> {
    const cwd = this.resolvePath(options.cwd);

    return new Promise((resolve, reject) => {
      this.connection.client.shell(
        {
          term: 'xterm-256color',
          cols: options.cols ?? 80,
          rows: options.rows ?? 24,
        },
        (err, stream) => {
          if (err) return reject(err);

          // Send initial commands
          stream.write(`cd ${this.shellQuote(cwd)}\n`);
          stream.write('clear\n');

          resolve(new SSHTerminal(stream, options));
        }
      );
    });
  }

  // File system implementation using SFTP
  fs: RuntimeFileSystem = {
    readFile: async (path) => {
      return new Promise((resolve, reject) => {
        const fullPath = this.resolvePath(path);
        this.sftp!.readFile(fullPath, (err, buffer) => {
          if (err) reject(err);
          else resolve(buffer);
        });
      });
    },

    writeFile: async (path, content) => {
      const fullPath = this.resolvePath(path);
      const tempPath = `${fullPath}.tmp.${Date.now()}`;

      // Atomic write: write to temp, then rename
      await new Promise<void>((resolve, reject) => {
        const buffer = typeof content === 'string'
          ? Buffer.from(content)
          : content;

        this.sftp!.writeFile(tempPath, buffer, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Get original permissions if file exists
      let mode = 0o644;
      try {
        const stats = await this.fs.stat(path);
        mode = stats.mode;
      } catch {
        // File doesn't exist, use default
      }

      // Set permissions on temp file
      await new Promise<void>((resolve, reject) => {
        this.sftp!.chmod(tempPath, mode, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Atomic rename
      await new Promise<void>((resolve, reject) => {
        this.sftp!.rename(tempPath, fullPath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },

    readdir: async (path) => {
      return new Promise((resolve, reject) => {
        const fullPath = this.resolvePath(path);
        this.sftp!.readdir(fullPath, (err, list) => {
          if (err) return reject(err);

          resolve(list.map(item => ({
            name: item.filename,
            isDirectory: item.attrs.isDirectory(),
            isFile: item.attrs.isFile(),
            isSymlink: item.attrs.isSymbolicLink(),
          })));
        });
      });
    },

    stat: async (path) => {
      return new Promise((resolve, reject) => {
        const fullPath = this.resolvePath(path);
        this.sftp!.stat(fullPath, (err, stats) => {
          if (err) return reject(err);

          resolve({
            size: stats.size,
            mtime: new Date(stats.mtime * 1000),
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            mode: stats.mode,
          });
        });
      });
    },

    exists: async (path) => {
      try {
        await this.fs.stat(path);
        return true;
      } catch {
        return false;
      }
    },

    mkdir: async (path, options) => {
      const fullPath = this.resolvePath(path);

      if (options?.recursive) {
        // SFTP doesn't have recursive mkdir, use command
        await this.exec(`mkdir -p ${this.shellQuote(fullPath)}`);
      } else {
        await new Promise<void>((resolve, reject) => {
          this.sftp!.mkdir(fullPath, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    },

    rm: async (path, options) => {
      const fullPath = this.resolvePath(path);

      if (options?.recursive) {
        await this.exec(`rm -rf ${this.shellQuote(fullPath)}`);
      } else {
        await new Promise<void>((resolve, reject) => {
          this.sftp!.unlink(fullPath, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    },

    watch: async (path, callback) => {
      // SFTP doesn't support watching - use polling
      const fullPath = this.resolvePath(path);
      let lastMtime: Date | null = null;

      const interval = setInterval(async () => {
        try {
          const stat = await this.fs.stat(path);
          if (lastMtime && stat.mtime > lastMtime) {
            callback({ type: 'change', path: fullPath });
          }
          lastMtime = stat.mtime;
        } catch {
          // File may have been deleted
          if (lastMtime) {
            callback({ type: 'unlink', path: fullPath });
            lastMtime = null;
          }
        }
      }, 1000);

      return () => clearInterval(interval);
    },
  };

  async captureState(): Promise<RuntimeState> {
    // Capture git state
    const gitStatus = await this.exec('git status --porcelain');
    const gitBranch = await this.exec('git branch --show-current');

    let stashRef: string | null = null;

    // Stash uncommitted changes if any
    if (gitStatus.stdout.trim()) {
      const stashResult = await this.exec('git stash push -m "superset-migration"');
      if (stashResult.exitCode === 0) {
        const refResult = await this.exec('git stash list -1 --format="%H"');
        stashRef = refResult.stdout.trim();
      }
    }

    return {
      type: 'ssh',
      host: this.connection.config.host,
      workingDir: this.workingDir,
      gitBranch: gitBranch.stdout.trim(),
      gitStashRef: stashRef,
    };
  }

  async restoreState(state: RuntimeState): Promise<void> {
    if (state.type !== 'ssh' && state.type !== 'cloud' && state.type !== 'local') {
      throw new Error(`Cannot restore ${state.type} state`);
    }

    // Checkout branch
    if (state.gitBranch) {
      await this.exec(`git checkout ${state.gitBranch}`);
    }

    // Apply stashed changes if any
    if (state.gitStashRef) {
      await this.exec(`git stash apply ${state.gitStashRef}`);
    }
  }

  // Private helpers

  private resolvePath(path?: string): string {
    if (!path) return this.workingDir;
    if (path.startsWith('/')) return path;
    return `${this.workingDir}/${path}`;
  }

  private shellQuote(s: string): string {
    return `'${s.replace(/'/g, "'\\''")}'`;
  }

  private setStatus(status: RuntimeStatus): void {
    this._status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private updateBusyStatus(): void {
    if (this.activeProcesses.size > 0) {
      this.setStatus({ state: 'busy', activeProcesses: this.activeProcesses.size });
    } else {
      this.setStatus({ state: 'ready' });
    }
  }

  get status(): RuntimeStatus {
    return this._status;
  }

  onStatusChange(callback: (status: RuntimeStatus) => void): Unsubscribe {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }
}
```

---

## 4. Cloud Runtime

The cloud runtime provides managed execution on Superset's infrastructure.

### 4.1 Cloud Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SUPERSET CLOUD ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Client (Electron App)                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  CloudClient                                                         │   │
│  │  ├── WebSocket connection to orchestrator                           │   │
│  │  ├── Request multiplexing                                            │   │
│  │  └── Reconnection with exponential backoff                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│                              │ WSS (TLS 1.3)                                 │
│                              ▼                                               │
│  Cloud Infrastructure                                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  API Gateway / Load Balancer                                         │   │
│  │  ├── Authentication (JWT)                                            │   │
│  │  ├── Rate limiting                                                   │   │
│  │  └── Geographic routing                                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Orchestrator                                                        │   │
│  │  ├── Worker pool management                                          │   │
│  │  ├── Session routing                                                 │   │
│  │  ├── Git sync coordination                                           │   │
│  │  └── Billing/usage tracking                                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│              ┌───────────────┼───────────────┐                              │
│              ▼               ▼               ▼                               │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐                   │
│  │   Worker 1    │  │   Worker 2    │  │   Worker N    │                   │
│  │  ┌─────────┐  │  │  ┌─────────┐  │  │  ┌─────────┐  │                   │
│  │  │Container│  │  │  │Container│  │  │  │Container│  │                   │
│  │  │ + Git   │  │  │  │ + Git   │  │  │  │ + Git   │  │                   │
│  │  │ + Claude│  │  │  │ + Claude│  │  │  │ + Claude│  │                   │
│  │  └─────────┘  │  │  └─────────┘  │  │  └─────────┘  │                   │
│  └───────────────┘  └───────────────┘  └───────────────┘                   │
│                                                                              │
│  Pre-warming Pool (idle, ready to assign)                                   │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐                   │
│  │   Warm 1      │  │   Warm 2      │  │   Warm 3      │                   │
│  └───────────────┘  └───────────────┘  └───────────────┘                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Cloud Client Implementation

```typescript
// packages/runtime/src/cloud/CloudClient.ts

export class CloudClient {
  private ws: WebSocket | null = null;
  private authenticated = false;
  private pendingRequests = new Map<string, PendingRequest>();
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timer | null = null;
  private eventListeners = new Map<string, Set<(data: any) => void>>();

  constructor(private config: CloudClientConfig) {}

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    return new Promise((resolve, reject) => {
      const wsUrl = `${this.config.endpoint}/ws`;
      this.ws = new WebSocket(wsUrl);

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        this.ws?.close();
      }, 10_000);

      this.ws.onopen = async () => {
        clearTimeout(timeout);
        try {
          await this.authenticate();
          this.reconnectAttempts = 0;
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(JSON.parse(event.data));
      };

      this.ws.onclose = () => {
        this.authenticated = false;
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        clearTimeout(timeout);
        reject(error);
      };
    });
  }

  async acquireWorker(options: WorkerOptions = {}): Promise<CloudWorker> {
    await this.ensureConnected();

    const response = await this.request<AcquireWorkerResponse>('acquire_worker', {
      region: options.region ?? 'auto',
      size: options.size ?? 'standard',
      timeout: options.timeout ?? 3600, // 1 hour default
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to acquire worker');
    }

    return new CloudWorker(response.worker, this);
  }

  async releaseWorker(workerId: string): Promise<void> {
    await this.request('release_worker', { workerId });
  }

  async getStatus(): Promise<CloudStatus> {
    try {
      await this.ensureConnected();
      return await this.request<CloudStatus>('status', {});
    } catch {
      return {
        authenticated: false,
        availableWorkers: 0,
      };
    }
  }

  // Streaming for terminal output
  subscribe(channel: string, callback: (data: any) => void): Unsubscribe {
    let listeners = this.eventListeners.get(channel);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(channel, listeners);
    }
    listeners.add(callback);

    return () => {
      listeners?.delete(callback);
      if (listeners?.size === 0) {
        this.eventListeners.delete(channel);
      }
    };
  }

  async send(channel: string, data: any): Promise<void> {
    await this.ensureConnected();

    this.ws!.send(JSON.stringify({
      type: 'channel_message',
      channel,
      data,
    }));
  }

  // Private implementation

  private async authenticate(): Promise<void> {
    const token = await this.config.getAuthToken();

    const response = await this.request<AuthResponse>('authenticate', { token });

    if (!response.success) {
      throw new Error(response.error ?? 'Authentication failed');
    }

    this.authenticated = true;
  }

  private async request<T>(method: string, params: any): Promise<T> {
    const id = this.generateRequestId();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, 30_000);

      this.pendingRequests.set(id, {
        resolve: (data) => {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          resolve(data as T);
        },
        reject: (error) => {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          reject(error);
        },
      });

      this.ws!.send(JSON.stringify({
        type: 'request',
        id,
        method,
        params,
      }));
    });
  }

  private handleMessage(message: CloudMessage): void {
    switch (message.type) {
      case 'response':
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          if (message.error) {
            pending.reject(new Error(message.error));
          } else {
            pending.resolve(message.result);
          }
        }
        break;

      case 'channel_message':
        const listeners = this.eventListeners.get(message.channel);
        if (listeners) {
          for (const listener of listeners) {
            listener(message.data);
          }
        }
        break;

      case 'error':
        console.error('Cloud error:', message.error);
        break;
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws?.readyState !== WebSocket.OPEN || !this.authenticated) {
      await this.connect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        // Will retry on next scheduleReconnect
      }
    }, delay);
  }

  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
```

### 4.3 Cloud Worker Handle

```typescript
// packages/runtime/src/cloud/CloudWorker.ts

export class CloudWorker {
  private disposed = false;

  constructor(
    private info: WorkerInfo,
    private client: CloudClient
  ) {}

  get id(): string {
    return this.info.id;
  }

  get region(): string {
    return this.info.region;
  }

  async syncRepository(options: SyncOptions): Promise<void> {
    if (this.disposed) throw new Error('Worker disposed');

    // Request orchestrator to sync git
    await this.client.request('sync_repository', {
      workerId: this.id,
      remote: options.remote,
      branch: options.branch,
      shallow: options.shallow ?? true,
    });
  }

  async exec(command: string, options: RemoteExecOptions = {}): Promise<ExecResult> {
    if (this.disposed) throw new Error('Worker disposed');

    return this.client.request('exec', {
      workerId: this.id,
      command,
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout,
    });
  }

  createTerminalChannel(): TerminalChannel {
    const channelId = `terminal:${this.id}:${Date.now()}`;

    return {
      id: channelId,

      write: (data: string) => {
        this.client.send(channelId, { type: 'input', data });
      },

      resize: (cols: number, rows: number) => {
        this.client.send(channelId, { type: 'resize', cols, rows });
      },

      onData: (callback: (data: string) => void) => {
        return this.client.subscribe(channelId, (msg) => {
          if (msg.type === 'output') {
            callback(msg.data);
          }
        });
      },

      onExit: (callback: (code: number) => void) => {
        return this.client.subscribe(channelId, (msg) => {
          if (msg.type === 'exit') {
            callback(msg.code);
          }
        });
      },

      close: () => {
        this.client.send(channelId, { type: 'close' });
      },
    };
  }

  async readFile(path: string): Promise<Buffer> {
    const response = await this.client.request<{ content: string }>('read_file', {
      workerId: this.id,
      path,
    });
    return Buffer.from(response.content, 'base64');
  }

  async writeFile(path: string, content: Buffer | string): Promise<void> {
    const base64 = typeof content === 'string'
      ? Buffer.from(content).toString('base64')
      : content.toString('base64');

    await this.client.request('write_file', {
      workerId: this.id,
      path,
      content: base64,
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.client.releaseWorker(this.id);
  }
}
```

### 4.4 Cloud Runtime Implementation

```typescript
// packages/runtime/src/cloud/CloudRuntime.ts

export class CloudRuntime implements Runtime {
  readonly type = 'cloud' as const;
  private _status: RuntimeStatus = { state: 'initializing' };
  private statusListeners = new Set<(status: RuntimeStatus) => void>();
  private terminalChannels = new Map<string, TerminalChannel>();
  private activeProcesses = new Map<string, ProcessHandle>();
  private workingDir = '/workspace';

  constructor(
    readonly id: string,
    private worker: CloudWorker,
    private client: CloudClient
  ) {}

  async initialize(): Promise<void> {
    try {
      // Worker should already be provisioned
      // Just verify it's responsive
      const result = await this.worker.exec('echo ok', { timeout: 5000 });

      if (result.exitCode !== 0) {
        throw new Error('Worker health check failed');
      }

      this.setStatus({ state: 'ready' });
    } catch (error: any) {
      this.setStatus({ state: 'error', error, recoverable: false });
      throw error;
    }
  }

  async dispose(): Promise<void> {
    // Close all terminals
    for (const [id, channel] of this.terminalChannels) {
      channel.close();
    }
    this.terminalChannels.clear();

    // Release worker
    await this.worker.dispose();
    this.setStatus({ state: 'disposed' });
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const result = await this.worker.exec('echo ok', { timeout: 5000 });

      return {
        healthy: result.exitCode === 0,
        latency: Date.now() - startTime,
        details: {
          type: 'cloud',
          region: this.worker.region,
          workerId: this.worker.id,
        },
      };
    } catch (error: any) {
      return {
        healthy: false,
        latency: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const cwd = options.cwd
      ? `${this.workingDir}/${options.cwd}`
      : this.workingDir;

    return this.worker.exec(command, {
      cwd,
      env: options.env,
      timeout: options.timeout,
    });
  }

  async spawn(command: string, options: SpawnOptions = {}): Promise<ProcessHandle> {
    // For long-running processes, we use a terminal channel
    const channel = this.worker.createTerminalChannel();

    // Start the command
    this.client.send(channel.id, {
      type: 'start',
      command,
      cwd: options.cwd ? `${this.workingDir}/${options.cwd}` : this.workingDir,
      env: options.env,
    });

    const handle = new CloudProcessHandle(channel);
    this.activeProcesses.set(channel.id, handle);

    handle.onExit(() => {
      this.activeProcesses.delete(channel.id);
      this.updateBusyStatus();
    });

    this.updateBusyStatus();
    return handle;
  }

  async createTerminal(options: TerminalOptions = {}): Promise<Terminal> {
    const channel = this.worker.createTerminalChannel();

    // Start shell
    this.client.send(channel.id, {
      type: 'start_shell',
      cwd: options.cwd ? `${this.workingDir}/${options.cwd}` : this.workingDir,
      env: options.env,
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
    });

    const terminal = new CloudTerminal(channel, options);
    this.terminalChannels.set(channel.id, channel);

    return terminal;
  }

  fs: RuntimeFileSystem = {
    readFile: (path) => this.worker.readFile(this.resolvePath(path)),

    writeFile: (path, content) => {
      const buffer = typeof content === 'string' ? Buffer.from(content) : content;
      return this.worker.writeFile(this.resolvePath(path), buffer);
    },

    readdir: async (path) => {
      const result = await this.worker.exec(
        `ls -la --time-style=+%s ${this.shellQuote(this.resolvePath(path))}`
      );
      return this.parseLsOutput(result.stdout);
    },

    stat: async (path) => {
      const result = await this.worker.exec(
        `stat --format='%s %Y %f %F' ${this.shellQuote(this.resolvePath(path))}`
      );
      return this.parseStatOutput(result.stdout);
    },

    exists: async (path) => {
      const result = await this.worker.exec(
        `test -e ${this.shellQuote(this.resolvePath(path))} && echo 1 || echo 0`
      );
      return result.stdout.trim() === '1';
    },

    mkdir: async (path, options) => {
      const flags = options?.recursive ? '-p' : '';
      await this.worker.exec(`mkdir ${flags} ${this.shellQuote(this.resolvePath(path))}`);
    },

    rm: async (path, options) => {
      const flags = options?.recursive ? '-rf' : '';
      await this.worker.exec(`rm ${flags} ${this.shellQuote(this.resolvePath(path))}`);
    },

    watch: async (path, callback) => {
      // Use inotifywait on the worker
      const channel = this.worker.createTerminalChannel();

      this.client.send(channel.id, {
        type: 'start',
        command: `inotifywait -m -r -e modify,create,delete,move ${this.shellQuote(this.resolvePath(path))}`,
      });

      const unsub = channel.onData((data) => {
        // Parse inotifywait output
        const match = data.match(/^(.+?)\s+(MODIFY|CREATE|DELETE|MOVED_TO|MOVED_FROM)\s+(.+)$/);
        if (match) {
          const [, dir, event, file] = match;
          callback({
            type: this.mapInotifyEvent(event),
            path: `${dir}${file}`,
          });
        }
      });

      return () => {
        unsub();
        channel.close();
      };
    },
  };

  async captureState(): Promise<RuntimeState> {
    const gitBranch = await this.exec('git branch --show-current');
    const gitStatus = await this.exec('git status --porcelain');

    let stashRef: string | null = null;
    if (gitStatus.stdout.trim()) {
      await this.exec('git stash push -m "superset-migration"');
      const refResult = await this.exec('git stash list -1 --format="%H"');
      stashRef = refResult.stdout.trim();
    }

    return {
      type: 'cloud',
      workerId: this.worker.id,
      workingDir: this.workingDir,
      gitBranch: gitBranch.stdout.trim(),
      gitStashRef: stashRef,
    };
  }

  async restoreState(state: RuntimeState): Promise<void> {
    if (state.gitBranch) {
      await this.exec(`git checkout ${state.gitBranch}`);
    }
    if (state.gitStashRef) {
      await this.exec(`git stash apply ${state.gitStashRef}`);
    }
  }

  // Private helpers

  private resolvePath(path: string): string {
    if (path.startsWith('/')) return path;
    return `${this.workingDir}/${path}`;
  }

  private shellQuote(s: string): string {
    return `'${s.replace(/'/g, "'\\''")}'`;
  }

  private setStatus(status: RuntimeStatus): void {
    this._status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private updateBusyStatus(): void {
    if (this.activeProcesses.size > 0) {
      this.setStatus({ state: 'busy', activeProcesses: this.activeProcesses.size });
    } else {
      this.setStatus({ state: 'ready' });
    }
  }

  private parseLsOutput(output: string): DirEntry[] {
    // Parse ls -la output
    const lines = output.trim().split('\n').slice(1); // Skip "total" line
    return lines.map(line => {
      const parts = line.split(/\s+/);
      const mode = parts[0];
      const name = parts.slice(8).join(' ');

      return {
        name,
        isDirectory: mode.startsWith('d'),
        isFile: mode.startsWith('-'),
        isSymlink: mode.startsWith('l'),
      };
    });
  }

  private parseStatOutput(output: string): FileStat {
    const [size, mtime, mode, type] = output.trim().split(' ');

    return {
      size: parseInt(size, 10),
      mtime: new Date(parseInt(mtime, 10) * 1000),
      isDirectory: type === 'directory',
      isFile: type === 'regular file',
      mode: parseInt(mode, 16),
    };
  }

  private mapInotifyEvent(event: string): FSEvent['type'] {
    switch (event) {
      case 'CREATE':
      case 'MOVED_TO':
        return 'add';
      case 'DELETE':
      case 'MOVED_FROM':
        return 'unlink';
      case 'MODIFY':
      default:
        return 'change';
    }
  }

  get status(): RuntimeStatus {
    return this._status;
  }

  onStatusChange(callback: (status: RuntimeStatus) => void): Unsubscribe {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }
}
```

### 4.5 Cloud Orchestrator (Server-Side)

```typescript
// This runs on Superset's infrastructure, not in the desktop app
// packages/cloud-orchestrator/src/Orchestrator.ts

export class Orchestrator {
  private workers = new Map<string, Worker>();
  private warmPool: Worker[] = [];
  private sessions = new Map<string, Session>();

  constructor(
    private infraProvider: InfrastructureProvider,  // Fly.io, K8s, etc.
    private config: OrchestratorConfig
  ) {
    // Maintain warm pool
    this.maintainWarmPool();
  }

  async acquireWorker(
    userId: string,
    options: AcquireOptions
  ): Promise<WorkerInfo> {
    // Check usage limits
    await this.checkUsageLimits(userId);

    // Try to get from warm pool
    let worker = this.warmPool.pop();

    if (!worker) {
      // No warm workers, provision new one
      worker = await this.provisionWorker(options);
    }

    // Assign to user
    worker.userId = userId;
    worker.assignedAt = new Date();
    this.workers.set(worker.id, worker);

    // Start usage tracking
    this.startUsageTracking(userId, worker.id);

    // Replenish warm pool in background
    this.replenishWarmPool();

    return {
      id: worker.id,
      region: worker.region,
      publicEndpoint: worker.publicEndpoint,
    };
  }

  async releaseWorker(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    // Stop usage tracking
    this.stopUsageTracking(worker.userId!, workerId);

    // Cleanup worker state
    await this.cleanupWorker(worker);

    // Return to warm pool if healthy, otherwise destroy
    if (worker.healthy && this.warmPool.length < this.config.warmPoolSize) {
      worker.userId = undefined;
      worker.assignedAt = undefined;
      this.warmPool.push(worker);
    } else {
      await this.destroyWorker(worker);
    }

    this.workers.delete(workerId);
  }

  async syncRepository(
    workerId: string,
    options: SyncOptions
  ): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) throw new Error('Worker not found');

    // Clone or fetch
    if (options.fullClone) {
      await worker.exec(`
        rm -rf /workspace/*
        git clone --branch ${options.branch} ${options.remote} /workspace
      `);
    } else {
      await worker.exec(`
        cd /workspace
        git fetch origin ${options.branch}
        git checkout ${options.branch}
        git reset --hard origin/${options.branch}
      `);
    }
  }

  // Private implementation

  private async provisionWorker(options: AcquireOptions): Promise<Worker> {
    const region = options.region === 'auto'
      ? this.selectOptimalRegion()
      : options.region;

    const machineType = this.getMachineType(options.size);

    // Provision via infrastructure provider
    const instance = await this.infraProvider.createInstance({
      region,
      machineType,
      image: 'superset-worker:latest',
      env: {
        CLAUDE_API_KEY: this.config.claudeApiKey,
      },
    });

    const worker: Worker = {
      id: instance.id,
      region,
      publicEndpoint: instance.publicEndpoint,
      healthy: true,
      createdAt: new Date(),
    };

    // Wait for worker to be ready
    await this.waitForReady(worker);

    return worker;
  }

  private async waitForReady(worker: Worker): Promise<void> {
    const maxAttempts = 30;
    const interval = 1000;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`${worker.publicEndpoint}/health`);
        if (response.ok) return;
      } catch {
        // Not ready yet
      }
      await sleep(interval);
    }

    throw new Error('Worker failed to become ready');
  }

  private async cleanupWorker(worker: Worker): Promise<void> {
    // Remove all files
    await worker.exec('rm -rf /workspace/*');

    // Kill any running processes
    await worker.exec('pkill -9 -u worker || true');

    // Reset environment
    await worker.exec('unset HISTFILE');
  }

  private async maintainWarmPool(): Promise<void> {
    setInterval(async () => {
      // Provision workers to maintain pool size
      while (this.warmPool.length < this.config.warmPoolSize) {
        try {
          const worker = await this.provisionWorker({ size: 'standard' });
          this.warmPool.push(worker);
        } catch (error) {
          console.error('Failed to provision warm worker:', error);
          break;
        }
      }

      // Health check warm workers
      for (let i = this.warmPool.length - 1; i >= 0; i--) {
        const worker = this.warmPool[i];
        try {
          const response = await fetch(`${worker.publicEndpoint}/health`);
          worker.healthy = response.ok;
        } catch {
          worker.healthy = false;
        }

        if (!worker.healthy) {
          this.warmPool.splice(i, 1);
          await this.destroyWorker(worker);
        }
      }

      // Auto-release idle workers
      const idleTimeout = this.config.idleTimeoutMs;
      for (const [id, worker] of this.workers) {
        if (worker.lastActivity) {
          const idleTime = Date.now() - worker.lastActivity.getTime();
          if (idleTime > idleTimeout) {
            await this.releaseWorker(id);
          }
        }
      }
    }, 30_000); // Every 30 seconds
  }

  private replenishWarmPool(): void {
    // Fire and forget - don't block the request
    setImmediate(async () => {
      if (this.warmPool.length < this.config.warmPoolSize) {
        try {
          const worker = await this.provisionWorker({ size: 'standard' });
          this.warmPool.push(worker);
        } catch {
          // Will retry on next interval
        }
      }
    });
  }

  private selectOptimalRegion(): string {
    // Could use client IP geolocation
    // For now, return default
    return this.config.defaultRegion;
  }

  private getMachineType(size?: string): string {
    switch (size) {
      case 'small': return 'shared-cpu-1x';
      case 'large': return 'performance-4x';
      case 'standard':
      default: return 'shared-cpu-2x';
    }
  }

  private async checkUsageLimits(userId: string): Promise<void> {
    const usage = await this.getUsage(userId);
    const limits = await this.getLimits(userId);

    if (usage.hoursThisMonth >= limits.monthlyHours) {
      throw new Error('Monthly usage limit exceeded');
    }

    if (usage.activeWorkers >= limits.concurrentWorkers) {
      throw new Error('Concurrent worker limit exceeded');
    }
  }
}
```

---

## 5. Git Synchronization

### 5.1 Efficient Sync Strategy

```typescript
// packages/runtime/src/git/GitSync.ts

export class GitSync {
  constructor(private runtime: Runtime) {}

  /**
   * Sync local repository to remote runtime.
   * Uses git's native protocols for efficiency.
   */
  async syncToRemote(options: SyncToRemoteOptions): Promise<void> {
    const { localPath, remotePath, branch } = options;

    // Strategy 1: If remote has a common ancestor, just push
    if (await this.hasCommonAncestor(remotePath, branch)) {
      await this.incrementalSync(localPath, remotePath, branch);
      return;
    }

    // Strategy 2: Full clone via git bundle
    await this.bundleSync(localPath, remotePath, branch);
  }

  /**
   * Sync remote changes back to local.
   */
  async syncFromRemote(options: SyncFromRemoteOptions): Promise<void> {
    const { localPath, remotePath, branch } = options;

    // Pull changes via SSH remote
    // This works for both SSH and Cloud runtimes
    await this.runtime.exec(
      `cd ${remotePath} && git push origin ${branch}`,
      { timeout: 60_000 }
    );
  }

  private async hasCommonAncestor(remotePath: string, branch: string): Promise<boolean> {
    try {
      const result = await this.runtime.exec(
        `cd ${remotePath} && git rev-parse HEAD`,
        { timeout: 5_000 }
      );
      return result.exitCode === 0 && result.stdout.trim().length === 40;
    } catch {
      return false;
    }
  }

  private async incrementalSync(
    localPath: string,
    remotePath: string,
    branch: string
  ): Promise<void> {
    // Get local HEAD
    const localHead = await this.getLocalHead(localPath);

    // Check if remote is behind
    const remoteHead = await this.runtime.exec(
      `cd ${remotePath} && git rev-parse HEAD`
    );

    if (remoteHead.stdout.trim() === localHead) {
      // Already in sync
      return;
    }

    // Create bundle of commits remote doesn't have
    const bundlePath = `/tmp/sync-${Date.now()}.bundle`;

    // Create bundle locally (in main process)
    const { execSync } = require('child_process');
    const bundle = execSync(
      `cd ${localPath} && git bundle create - ${remoteHead.stdout.trim()}..HEAD`,
      { maxBuffer: 100 * 1024 * 1024 } // 100MB
    );

    // Write bundle to remote
    await this.runtime.fs.writeFile(bundlePath, bundle);

    // Apply bundle on remote
    await this.runtime.exec(`
      cd ${remotePath}
      git fetch ${bundlePath}
      git checkout ${branch}
      git reset --hard FETCH_HEAD
      rm ${bundlePath}
    `);
  }

  private async bundleSync(
    localPath: string,
    remotePath: string,
    branch: string
  ): Promise<void> {
    const bundlePath = `/tmp/full-${Date.now()}.bundle`;

    // Create full bundle locally
    const { execSync } = require('child_process');
    const bundle = execSync(
      `cd ${localPath} && git bundle create - --all`,
      { maxBuffer: 500 * 1024 * 1024 } // 500MB
    );

    // Ensure remote directory exists
    await this.runtime.fs.mkdir(remotePath, { recursive: true });

    // Write bundle
    await this.runtime.fs.writeFile(bundlePath, bundle);

    // Clone from bundle
    await this.runtime.exec(`
      cd ${remotePath}
      git clone ${bundlePath} .
      git checkout ${branch}
      rm ${bundlePath}
    `);
  }

  private async getLocalHead(localPath: string): Promise<string> {
    const { execSync } = require('child_process');
    return execSync(`cd ${localPath} && git rev-parse HEAD`, { encoding: 'utf-8' }).trim();
  }
}
```

### 5.2 Real-Time File Watching & Sync

```typescript
// packages/runtime/src/git/RealtimeSync.ts

export class RealtimeSync {
  private watcher: FSWatcher | null = null;
  private syncQueue: Set<string> = new Set();
  private syncDebounce: NodeJS.Timer | null = null;

  constructor(
    private localRuntime: LocalRuntime,
    private remoteRuntime: Runtime,
    private options: RealtimeSyncOptions
  ) {}

  async start(): Promise<void> {
    // Watch local filesystem
    this.watcher = watch(this.options.localPath, {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
      ],
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    this.watcher.on('all', (event, path) => {
      this.queueSync(path);
    });
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }

  private queueSync(path: string): void {
    this.syncQueue.add(path);

    // Debounce syncs
    if (this.syncDebounce) {
      clearTimeout(this.syncDebounce);
    }

    this.syncDebounce = setTimeout(() => {
      this.processSyncQueue();
    }, 300);
  }

  private async processSyncQueue(): Promise<void> {
    const paths = Array.from(this.syncQueue);
    this.syncQueue.clear();

    // Group by type of change
    const toSync: string[] = [];
    const toDelete: string[] = [];

    for (const path of paths) {
      const exists = await this.localRuntime.fs.exists(path);
      if (exists) {
        toSync.push(path);
      } else {
        toDelete.push(path);
      }
    }

    // Sync changed files
    await Promise.all(
      toSync.map(async (path) => {
        const relativePath = path.replace(this.options.localPath, '');
        const content = await this.localRuntime.fs.readFile(path);
        await this.remoteRuntime.fs.writeFile(
          `${this.options.remotePath}${relativePath}`,
          content
        );
      })
    );

    // Delete removed files
    await Promise.all(
      toDelete.map(async (path) => {
        const relativePath = path.replace(this.options.localPath, '');
        await this.remoteRuntime.fs.rm(
          `${this.options.remotePath}${relativePath}`
        );
      })
    );
  }
}
```

---

## 6. Terminal Streaming

### 6.1 WebSocket Terminal Protocol

```typescript
// packages/runtime/src/terminal/TerminalProtocol.ts

/**
 * Terminal protocol over WebSocket.
 * Designed for low latency and efficient binary transmission.
 */

// Message types
enum TerminalMessageType {
  // Client -> Server
  INPUT = 0x01,
  RESIZE = 0x02,
  PING = 0x03,

  // Server -> Client
  OUTPUT = 0x11,
  EXIT = 0x12,
  PONG = 0x13,
  ERROR = 0x14,
}

// Binary message format:
// [1 byte type][4 bytes length][payload]

export class TerminalProtocol {
  static encode(type: TerminalMessageType, payload: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(5 + payload.length);
    const view = new DataView(buffer);

    view.setUint8(0, type);
    view.setUint32(1, payload.length, true);

    const payloadView = new Uint8Array(buffer, 5);
    payloadView.set(payload);

    return buffer;
  }

  static decode(buffer: ArrayBuffer): { type: TerminalMessageType; payload: Uint8Array } {
    const view = new DataView(buffer);
    const type = view.getUint8(0) as TerminalMessageType;
    const length = view.getUint32(1, true);
    const payload = new Uint8Array(buffer, 5, length);

    return { type, payload };
  }

  static encodeInput(data: string): ArrayBuffer {
    return this.encode(
      TerminalMessageType.INPUT,
      new TextEncoder().encode(data)
    );
  }

  static encodeResize(cols: number, rows: number): ArrayBuffer {
    const payload = new Uint8Array(4);
    const view = new DataView(payload.buffer);
    view.setUint16(0, cols, true);
    view.setUint16(2, rows, true);
    return this.encode(TerminalMessageType.RESIZE, payload);
  }

  static decodeOutput(buffer: ArrayBuffer): string {
    const { type, payload } = this.decode(buffer);
    if (type !== TerminalMessageType.OUTPUT) {
      throw new Error(`Expected OUTPUT, got ${type}`);
    }
    return new TextDecoder().decode(payload);
  }
}
```

### 6.2 Terminal Multiplexer

```typescript
// packages/runtime/src/terminal/TerminalMultiplexer.ts

/**
 * Manages multiple terminal sessions over a single WebSocket connection.
 * Reduces connection overhead and enables efficient routing.
 */

export class TerminalMultiplexer {
  private terminals = new Map<string, MultiplexedTerminal>();
  private ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.setupMessageHandler();
  }

  createTerminal(id: string): MultiplexedTerminal {
    const terminal = new MultiplexedTerminal(id, this);
    this.terminals.set(id, terminal);
    return terminal;
  }

  destroyTerminal(id: string): void {
    const terminal = this.terminals.get(id);
    if (terminal) {
      terminal.dispose();
      this.terminals.delete(id);
    }
  }

  send(terminalId: string, type: TerminalMessageType, payload: Uint8Array): void {
    // Prefix with terminal ID (4 bytes hash)
    const idHash = this.hashId(terminalId);
    const buffer = new ArrayBuffer(4 + 5 + payload.length);
    const view = new DataView(buffer);

    view.setUint32(0, idHash, true);
    view.setUint8(4, type);
    view.setUint32(5, payload.length, true);

    new Uint8Array(buffer, 9).set(payload);

    this.ws.send(buffer);
  }

  private setupMessageHandler(): void {
    this.ws.binaryType = 'arraybuffer';

    this.ws.onmessage = (event) => {
      const buffer = event.data as ArrayBuffer;
      const view = new DataView(buffer);

      const idHash = view.getUint32(0, true);
      const type = view.getUint8(4) as TerminalMessageType;
      const length = view.getUint32(5, true);
      const payload = new Uint8Array(buffer, 9, length);

      // Route to appropriate terminal
      for (const [id, terminal] of this.terminals) {
        if (this.hashId(id) === idHash) {
          terminal.handleMessage(type, payload);
          break;
        }
      }
    };
  }

  private hashId(id: string): number {
    // Simple hash for terminal ID routing
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash = hash & hash;
    }
    return hash >>> 0;
  }
}

class MultiplexedTerminal implements Terminal {
  private outputListeners = new Set<(data: Uint8Array) => void>();
  private exitListeners = new Set<(result: ExecResult) => void>();
  private scrollback: Uint8Array[] = [];

  constructor(
    private id: string,
    private multiplexer: TerminalMultiplexer
  ) {}

  get pid(): string {
    return this.id;
  }

  get running(): boolean {
    return true; // Managed by server
  }

  get stdout(): ReadableStream<Uint8Array> {
    return this.output;
  }

  get stderr(): ReadableStream<Uint8Array> {
    return new ReadableStream(); // Combined in terminal
  }

  get stdin(): WritableStream<Uint8Array> {
    return new WritableStream({
      write: (chunk) => {
        this.multiplexer.send(this.id, TerminalMessageType.INPUT, chunk);
      },
    });
  }

  get output(): ReadableStream<Uint8Array> {
    const listeners = this.outputListeners;
    return new ReadableStream({
      start(controller) {
        const listener = (data: Uint8Array) => {
          controller.enqueue(data);
        };
        listeners.add(listener);
      },
    });
  }

  async resize(cols: number, rows: number): Promise<void> {
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setUint16(0, cols, true);
    new DataView(payload.buffer).setUint16(2, rows, true);
    this.multiplexer.send(this.id, TerminalMessageType.RESIZE, payload);
  }

  async kill(signal = 'SIGTERM'): Promise<void> {
    // Send kill signal
    const payload = new TextEncoder().encode(signal);
    this.multiplexer.send(this.id, TerminalMessageType.INPUT,
      new TextEncoder().encode('\x03')); // Ctrl+C
  }

  async wait(): Promise<ExecResult> {
    return new Promise((resolve) => {
      this.exitListeners.add(resolve);
    });
  }

  onExit(callback: (result: ExecResult) => void): Unsubscribe {
    this.exitListeners.add(callback);
    return () => this.exitListeners.delete(callback);
  }

  async getScrollback(): Promise<string> {
    return new TextDecoder().decode(
      new Uint8Array(this.scrollback.flatMap(arr => Array.from(arr)))
    );
  }

  handleMessage(type: TerminalMessageType, payload: Uint8Array): void {
    switch (type) {
      case TerminalMessageType.OUTPUT:
        this.scrollback.push(payload);
        // Keep last ~1MB
        while (this.scrollback.reduce((a, b) => a + b.length, 0) > 1_000_000) {
          this.scrollback.shift();
        }
        for (const listener of this.outputListeners) {
          listener(payload);
        }
        break;

      case TerminalMessageType.EXIT:
        const code = new DataView(payload.buffer).getInt32(0, true);
        const result: ExecResult = {
          stdout: '',
          stderr: '',
          exitCode: code,
          timedOut: false,
        };
        for (const listener of this.exitListeners) {
          listener(result);
        }
        break;
    }
  }

  dispose(): void {
    this.outputListeners.clear();
    this.exitListeners.clear();
  }
}
```

---

## 7. Workspace State & Migration

### 7.1 State Capture

```typescript
// packages/runtime/src/state/StateCapture.ts

export interface RuntimeState {
  type: RuntimeType;
  version: number;
  timestamp: Date;

  // Git state
  gitBranch: string;
  gitStashRef?: string;
  gitUncommittedFiles?: string[];

  // Terminal state (optional)
  terminals?: TerminalState[];

  // Agent state (optional)
  agents?: AgentState[];
}

export interface TerminalState {
  id: string;
  cwd: string;
  scrollback: string;
  cols: number;
  rows: number;
}

export interface AgentState {
  id: string;
  prompt: string;
  conversationHistory: Message[];
  status: 'running' | 'paused' | 'waiting_input';
}

export class StateManager {
  constructor(private runtime: Runtime) {}

  async capture(options: CaptureOptions = {}): Promise<RuntimeState> {
    const state: RuntimeState = {
      type: this.runtime.type,
      version: 1,
      timestamp: new Date(),
      gitBranch: '',
    };

    // Capture git state
    const branchResult = await this.runtime.exec('git branch --show-current');
    state.gitBranch = branchResult.stdout.trim();

    // Check for uncommitted changes
    const statusResult = await this.runtime.exec('git status --porcelain');
    if (statusResult.stdout.trim()) {
      state.gitUncommittedFiles = statusResult.stdout
        .trim()
        .split('\n')
        .map(line => line.slice(3));

      // Stash changes
      if (options.stashChanges !== false) {
        const stashResult = await this.runtime.exec(
          'git stash push -m "superset-state-capture"'
        );
        if (stashResult.exitCode === 0) {
          const refResult = await this.runtime.exec(
            'git stash list -1 --format="%H"'
          );
          state.gitStashRef = refResult.stdout.trim();
        }
      }
    }

    // Capture terminal state if requested
    if (options.includeTerminals) {
      // This would need access to active terminals
      // Implementation depends on how terminals are managed
    }

    // Capture agent state if requested
    if (options.includeAgents) {
      // This would need access to agent manager
      // Implementation depends on agent architecture
    }

    return state;
  }

  async restore(state: RuntimeState): Promise<void> {
    // Checkout branch
    if (state.gitBranch) {
      const currentBranch = await this.runtime.exec('git branch --show-current');
      if (currentBranch.stdout.trim() !== state.gitBranch) {
        await this.runtime.exec(`git checkout ${state.gitBranch}`);
      }
    }

    // Apply stashed changes
    if (state.gitStashRef) {
      await this.runtime.exec(`git stash apply ${state.gitStashRef}`);
    }

    // Restore terminals would require creating new terminals
    // and writing scrollback to them

    // Restore agents would require re-initializing agent sessions
    // with their conversation history
  }
}
```

### 7.2 Workspace Migration

```typescript
// packages/runtime/src/migration/WorkspaceMigration.ts

export class WorkspaceMigration {
  constructor(
    private runtimeFactory: RuntimeFactory,
    private gitSync: GitSync
  ) {}

  async migrate(
    workspace: Workspace,
    targetConfig: RuntimeConfig
  ): Promise<Workspace> {
    const sourceRuntime = workspace.runtime;

    // 1. Capture current state
    const stateManager = new StateManager(sourceRuntime);
    const state = await stateManager.capture({
      stashChanges: true,
      includeTerminals: true,
      includeAgents: true,
    });

    // 2. Create target runtime
    const targetRuntime = await this.runtimeFactory.create(
      targetConfig,
      workspace.id
    );
    await targetRuntime.initialize();

    try {
      // 3. Sync repository to target
      if (targetConfig.type === 'cloud' || targetConfig.type === 'ssh') {
        await this.gitSync.syncToRemote({
          localPath: workspace.localPath,
          remotePath: '/workspace', // Or configured path
          branch: state.gitBranch,
        });
      }

      // 4. Restore state on target
      const targetStateManager = new StateManager(targetRuntime);
      await targetStateManager.restore(state);

      // 5. Migrate terminals
      const newTerminals: Terminal[] = [];
      if (state.terminals) {
        for (const termState of state.terminals) {
          const term = await targetRuntime.createTerminal({
            cwd: termState.cwd,
            cols: termState.cols,
            rows: termState.rows,
          });
          // Note: Can't truly restore scrollback, but could inject as output
          newTerminals.push(term);
        }
      }

      // 6. Dispose source runtime
      await sourceRuntime.dispose();

      // 7. Return updated workspace
      return {
        ...workspace,
        runtime: targetRuntime,
        runtimeType: targetConfig.type,
      };
    } catch (error) {
      // Cleanup on failure
      await targetRuntime.dispose();
      throw error;
    }
  }
}
```

---

## 8. Security Architecture

### 8.1 Authentication Flow

```typescript
// packages/auth/src/AuthManager.ts

export class AuthManager {
  private tokenCache: Map<string, CachedToken> = new Map();

  constructor(private config: AuthConfig) {}

  async getCloudToken(): Promise<string> {
    const cached = this.tokenCache.get('cloud');
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    // Refresh token
    const token = await this.refreshToken();
    this.tokenCache.set('cloud', {
      token,
      expiresAt: Date.now() + 3600_000, // 1 hour
    });

    return token;
  }

  private async refreshToken(): Promise<string> {
    // Use secure token storage
    const refreshToken = await this.getStoredRefreshToken();

    if (!refreshToken) {
      throw new Error('Not authenticated. Please sign in.');
    }

    const response = await fetch(`${this.config.authEndpoint}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.config.clientId,
      }),
    });

    if (!response.ok) {
      throw new Error('Token refresh failed');
    }

    const data = await response.json();

    // Store new refresh token
    if (data.refresh_token) {
      await this.storeRefreshToken(data.refresh_token);
    }

    return data.access_token;
  }

  private async getStoredRefreshToken(): Promise<string | null> {
    // Use system keychain on macOS/Windows
    // Or encrypted file on Linux
    if (process.platform === 'darwin') {
      const { execSync } = require('child_process');
      try {
        return execSync(
          `security find-generic-password -s "superset" -w`,
          { encoding: 'utf-8' }
        ).trim();
      } catch {
        return null;
      }
    }

    // Fallback to encrypted file
    return this.readEncryptedFile('refresh_token');
  }

  private async storeRefreshToken(token: string): Promise<void> {
    if (process.platform === 'darwin') {
      const { execSync } = require('child_process');
      execSync(
        `security add-generic-password -s "superset" -a "refresh_token" -w "${token}" -U`
      );
      return;
    }

    await this.writeEncryptedFile('refresh_token', token);
  }
}
```

### 8.2 SSH Key Management

```typescript
// packages/runtime/src/ssh/KeyManager.ts

export class SSHKeyManager {
  /**
   * We DON'T manage SSH keys directly.
   * We delegate to the system SSH agent and config.
   * This is intentional - users already have SSH setup.
   */

  async validateSSHSetup(): Promise<SSHSetupStatus> {
    const results: SSHSetupStatus = {
      agent: false,
      defaultKeys: [],
      configHosts: [],
    };

    // Check SSH agent
    if (process.env.SSH_AUTH_SOCK) {
      try {
        const { execSync } = require('child_process');
        const output = execSync('ssh-add -l', { encoding: 'utf-8' });
        results.agent = !output.includes('no identities');
      } catch {
        results.agent = false;
      }
    }

    // Check default keys
    const keyNames = ['id_ed25519', 'id_rsa', 'id_ecdsa'];
    for (const name of keyNames) {
      const path = join(homedir(), '.ssh', name);
      if (existsSync(path)) {
        results.defaultKeys.push(name);
      }
    }

    // Parse SSH config
    const configPath = join(homedir(), '.ssh', 'config');
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      const parsed = parseSSHConfig(content);

      for (const section of parsed) {
        if (section.type === 1 && section.param === 'Host') {
          if (!section.value.includes('*')) {
            results.configHosts.push(section.value);
          }
        }
      }
    }

    return results;
  }

  async testConnection(host: string): Promise<ConnectionTestResult> {
    const { execSync } = require('child_process');

    try {
      // Quick connectivity test
      execSync(
        `ssh -o BatchMode=yes -o ConnectTimeout=5 ${host} exit`,
        { encoding: 'utf-8', stdio: 'pipe' }
      );

      return { success: true };
    } catch (error: any) {
      // Parse error
      if (error.message.includes('Permission denied')) {
        return {
          success: false,
          error: 'permission_denied',
          message: 'SSH key not accepted. Check your SSH config.',
        };
      }
      if (error.message.includes('Connection refused')) {
        return {
          success: false,
          error: 'connection_refused',
          message: 'SSH server not running or port blocked.',
        };
      }
      if (error.message.includes('No route to host')) {
        return {
          success: false,
          error: 'unreachable',
          message: 'Host is unreachable. Check network connection.',
        };
      }

      return {
        success: false,
        error: 'unknown',
        message: error.message,
      };
    }
  }
}
```

### 8.3 Cloud Worker Isolation

```typescript
// Worker container security (server-side)
// packages/cloud-orchestrator/src/WorkerSecurity.ts

export const WORKER_SECURITY_CONFIG = {
  // Container security
  container: {
    // Run as non-root
    user: 'worker',
    uid: 1000,
    gid: 1000,

    // Resource limits
    memory: '4g',
    cpus: 2,
    pids: 1000,

    // Filesystem
    readOnlyRootfs: false, // Need to write to /workspace
    tmpfs: ['/tmp:size=1g'],

    // Capabilities
    capDrop: ['ALL'],
    capAdd: ['CHOWN', 'SETUID', 'SETGID'],

    // Seccomp profile
    seccompProfile: 'default',

    // Network
    networkMode: 'bridge',
    dns: ['8.8.8.8', '8.8.4.4'],
  },

  // Environment sanitization
  environment: {
    // Never expose
    forbidden: [
      'AWS_SECRET_ACCESS_KEY',
      'ANTHROPIC_API_KEY',
      'DATABASE_URL',
    ],

    // Always set
    required: {
      HOME: '/home/worker',
      USER: 'worker',
      SHELL: '/bin/bash',
    },
  },

  // Cleanup between users
  cleanup: {
    // Files to remove
    paths: [
      '/workspace/*',
      '/home/worker/.bash_history',
      '/home/worker/.ssh/*',
      '/tmp/*',
    ],

    // Processes to kill
    killAll: true,
  },
};
```

---

## 9. Observability & Reliability

### 9.1 Metrics Collection

```typescript
// packages/runtime/src/metrics/MetricsCollector.ts

export class MetricsCollector {
  private metrics = new Map<string, Metric>();

  constructor(private reporter: MetricsReporter) {
    // Report metrics every 30 seconds
    setInterval(() => this.flush(), 30_000);
  }

  // Counters
  incrementCounter(name: string, tags?: Record<string, string>): void {
    const key = this.metricKey(name, tags);
    const metric = this.metrics.get(key) as CounterMetric ?? { type: 'counter', value: 0 };
    metric.value++;
    this.metrics.set(key, metric);
  }

  // Gauges
  setGauge(name: string, value: number, tags?: Record<string, string>): void {
    const key = this.metricKey(name, tags);
    this.metrics.set(key, { type: 'gauge', value });
  }

  // Histograms
  recordHistogram(name: string, value: number, tags?: Record<string, string>): void {
    const key = this.metricKey(name, tags);
    const metric = this.metrics.get(key) as HistogramMetric ?? {
      type: 'histogram',
      values: [],
    };
    metric.values.push(value);

    // Keep last 1000 values
    if (metric.values.length > 1000) {
      metric.values = metric.values.slice(-1000);
    }

    this.metrics.set(key, metric);
  }

  // Timer helper
  startTimer(name: string, tags?: Record<string, string>): () => void {
    const start = Date.now();
    return () => {
      this.recordHistogram(name, Date.now() - start, tags);
    };
  }

  private flush(): void {
    const batch: MetricBatch = {
      timestamp: new Date(),
      metrics: [],
    };

    for (const [key, metric] of this.metrics) {
      const [name, tagsJson] = key.split('|');
      const tags = tagsJson ? JSON.parse(tagsJson) : {};

      if (metric.type === 'histogram') {
        // Calculate percentiles
        const sorted = [...metric.values].sort((a, b) => a - b);
        batch.metrics.push({
          name,
          tags,
          values: {
            p50: this.percentile(sorted, 50),
            p90: this.percentile(sorted, 90),
            p99: this.percentile(sorted, 99),
            count: sorted.length,
          },
        });
        metric.values = []; // Reset
      } else {
        batch.metrics.push({
          name,
          tags,
          value: metric.value,
        });
      }
    }

    this.reporter.report(batch);
  }

  private metricKey(name: string, tags?: Record<string, string>): string {
    return tags ? `${name}|${JSON.stringify(tags)}` : name;
  }

  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)] ?? 0;
  }
}

// Key metrics to track
export const RUNTIME_METRICS = {
  // Connection pool
  'ssh.pool.acquire.duration': 'histogram',
  'ssh.pool.connections.active': 'gauge',
  'ssh.pool.connections.healthy': 'gauge',
  'ssh.pool.probe.failures': 'counter',

  // Cloud
  'cloud.worker.acquire.duration': 'histogram',
  'cloud.worker.warm_pool.size': 'gauge',
  'cloud.worker.utilization': 'gauge',

  // Execution
  'runtime.exec.duration': 'histogram',
  'runtime.exec.failures': 'counter',
  'runtime.exec.timeouts': 'counter',

  // Terminal
  'terminal.sessions.active': 'gauge',
  'terminal.bytes.sent': 'counter',
  'terminal.bytes.received': 'counter',
  'terminal.latency': 'histogram',

  // Git sync
  'git.sync.duration': 'histogram',
  'git.sync.bytes': 'counter',
  'git.sync.failures': 'counter',
};
```

### 9.2 Error Handling & Recovery

```typescript
// packages/runtime/src/reliability/ErrorRecovery.ts

export class ErrorRecovery {
  private errorCounts = new Map<string, number>();
  private circuitBreakers = new Map<string, CircuitBreaker>();

  constructor(private config: RecoveryConfig) {}

  async withRecovery<T>(
    operation: () => Promise<T>,
    options: RecoveryOptions
  ): Promise<T> {
    const breaker = this.getCircuitBreaker(options.name);

    if (breaker.isOpen()) {
      throw new Error(`Circuit breaker open for ${options.name}`);
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < options.maxRetries; attempt++) {
      try {
        const result = await operation();
        breaker.recordSuccess();
        return result;
      } catch (error: any) {
        lastError = error;

        // Check if retryable
        if (!this.isRetryable(error, options)) {
          breaker.recordFailure();
          throw error;
        }

        // Wait before retry
        const delay = this.calculateBackoff(attempt, options);
        await sleep(delay);
      }
    }

    breaker.recordFailure();
    throw lastError ?? new Error('Max retries exceeded');
  }

  private isRetryable(error: Error, options: RecoveryOptions): boolean {
    // Connection errors are generally retryable
    if (error.message.includes('ECONNRESET')) return true;
    if (error.message.includes('ETIMEDOUT')) return true;
    if (error.message.includes('ENOTFOUND')) return true;

    // SSH specific
    if (error.message.includes('Connection refused')) return true;
    if (error.message.includes('Connection closed')) return true;

    // Cloud specific
    if (error.message.includes('Worker not ready')) return true;
    if (error.message.includes('Rate limited')) return true;

    // Check custom retryable errors
    if (options.retryableErrors) {
      return options.retryableErrors.some(re => error.message.includes(re));
    }

    return false;
  }

  private calculateBackoff(attempt: number, options: RecoveryOptions): number {
    const base = options.baseDelay ?? 1000;
    const max = options.maxDelay ?? 30000;

    // Exponential backoff with jitter
    const exponential = Math.min(base * Math.pow(2, attempt), max);
    const jitter = exponential * 0.2 * Math.random();

    return exponential + jitter;
  }

  private getCircuitBreaker(name: string): CircuitBreaker {
    let breaker = this.circuitBreakers.get(name);
    if (!breaker) {
      breaker = new CircuitBreaker(this.config.circuitBreaker);
      this.circuitBreakers.set(name, breaker);
    }
    return breaker;
  }
}

class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failures = 0;
  private lastFailure?: Date;
  private successCount = 0;

  constructor(private config: CircuitBreakerConfig) {}

  isOpen(): boolean {
    if (this.state === 'open') {
      // Check if we should try half-open
      if (this.lastFailure) {
        const elapsed = Date.now() - this.lastFailure.getTime();
        if (elapsed > this.config.resetTimeout) {
          this.state = 'half-open';
          return false;
        }
      }
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.config.halfOpenSuccesses) {
        this.reset();
      }
    } else {
      this.failures = 0;
    }
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailure = new Date();
    this.successCount = 0;

    if (this.failures >= this.config.failureThreshold) {
      this.state = 'open';
    }
  }

  private reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successCount = 0;
    this.lastFailure = undefined;
  }
}
```

---

## 10. Infrastructure Decisions

### 10.1 Cloud Provider Comparison

| Provider | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| **Fly.io** | Fast provisioning, global edge, simple API, good pricing | Less mature, smaller ecosystem | Best for MVP |
| **Railway** | Great DX, easy deploys, managed Postgres | Limited regions, higher cost at scale | Good alternative |
| **AWS ECS** | Battle-tested, full control, extensive features | Complex, slow cold starts, expensive for small scale | Enterprise option |
| **GCP Cloud Run** | Good scaling, generous free tier | Cold starts, less control | Cost-effective option |
| **Kubernetes** | Full control, portable | Operational complexity | Self-hosted option |

**Recommendation**: Start with **Fly.io** for MVP, plan for **Kubernetes** migration at scale.

### 10.2 Fly.io Implementation

```typescript
// packages/cloud-orchestrator/src/infra/FlyProvider.ts

export class FlyInfraProvider implements InfrastructureProvider {
  private fly: FlyClient;

  constructor(config: FlyConfig) {
    this.fly = new FlyClient({
      token: config.apiToken,
      org: config.organization,
    });
  }

  async createInstance(options: CreateInstanceOptions): Promise<Instance> {
    const machine = await this.fly.machines.create({
      app: options.appName ?? 'superset-workers',
      region: options.region,
      config: {
        image: options.image,
        guest: this.getGuestConfig(options.machineType),
        env: options.env,
        services: [
          {
            protocol: 'tcp',
            internal_port: 8080,
            ports: [
              {
                port: 443,
                handlers: ['tls', 'http'],
              },
            ],
          },
        ],
        checks: {
          health: {
            type: 'http',
            port: 8080,
            path: '/health',
            interval: '10s',
            timeout: '2s',
          },
        },
      },
    });

    return {
      id: machine.id,
      region: machine.region,
      publicEndpoint: `https://${machine.id}.fly.dev`,
      privateIp: machine.private_ip,
    };
  }

  async destroyInstance(id: string): Promise<void> {
    await this.fly.machines.destroy(id);
  }

  async listInstances(): Promise<Instance[]> {
    const machines = await this.fly.machines.list('superset-workers');
    return machines.map(m => ({
      id: m.id,
      region: m.region,
      publicEndpoint: `https://${m.id}.fly.dev`,
      privateIp: m.private_ip,
      state: m.state,
    }));
  }

  private getGuestConfig(machineType: string): FlyGuestConfig {
    switch (machineType) {
      case 'shared-cpu-1x':
        return { cpu_kind: 'shared', cpus: 1, memory_mb: 1024 };
      case 'shared-cpu-2x':
        return { cpu_kind: 'shared', cpus: 2, memory_mb: 2048 };
      case 'performance-4x':
        return { cpu_kind: 'performance', cpus: 4, memory_mb: 8192 };
      default:
        return { cpu_kind: 'shared', cpus: 2, memory_mb: 2048 };
    }
  }
}
```

### 10.3 Worker Container Image

```dockerfile
# Dockerfile for Superset worker
FROM ubuntu:22.04

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    openssh-client \
    inotify-tools \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code
RUN curl -fsSL https://claude.ai/install.sh | sh

# Install Node.js (for tooling)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Create worker user
RUN useradd -m -s /bin/bash -u 1000 worker

# Setup workspace
RUN mkdir -p /workspace && chown worker:worker /workspace

# Worker agent (handles WebSocket, terminal multiplexing)
COPY --chown=worker:worker worker-agent /usr/local/bin/worker-agent

# Switch to worker user
USER worker
WORKDIR /workspace

# Health check
HEALTHCHECK --interval=10s --timeout=2s --start-period=5s \
    CMD curl -f http://localhost:8080/health || exit 1

# Start worker agent
CMD ["worker-agent"]
```

---

## Conclusion

This technical deep dive provides a comprehensive blueprint for building Superset's hybrid runtime architecture. Key takeaways:

1. **Clean abstraction layer**: The `Runtime` interface hides complexity from the rest of the app
2. **SSH done right**: Connection pooling with health tracking (from Mux)
3. **Cloud as managed infrastructure**: Pre-warmed workers, WebSocket streaming, efficient git sync
4. **State migration**: Enable seamless movement between runtimes
5. **Security by design**: System SSH delegation, container isolation, proper auth
6. **Observable and reliable**: Metrics, circuit breakers, retry logic

The architecture is designed to be incrementally buildable:
- Phase 1: Local runtime (exists) + SSH runtime
- Phase 2: Cloud infrastructure + orchestrator
- Phase 3: State migration + advanced features

Each component is independently testable and can be deployed incrementally without disrupting existing functionality.
