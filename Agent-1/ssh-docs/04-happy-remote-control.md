# Happy Remote Control - Deep Technical Analysis

## Overview

Happy implements a **WebSocket-based remote control system** enabling mobile devices to control desktop Claude Code instances. Unlike traditional SSH or tunnel-based approaches, Happy uses a relay-based architecture with end-to-end encryption for secure real-time communication.

**Key Files**:
- `packages/relay/` (WebSocket relay server)
- `packages/crypto/` (E2E encryption)
- `apps/mobile/` (React Native mobile app)
- `apps/desktop/` (Electron desktop app)

---

## Architecture

### Relay-Based Communication

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        HAPPY REMOTE CONTROL                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────┐                               ┌─────────────┐            │
│   │   Mobile    │                               │   Desktop   │            │
│   │    App      │                               │    App      │            │
│   │  (Control)  │                               │  (Claude)   │            │
│   └──────┬──────┘                               └──────┬──────┘            │
│          │                                             │                    │
│          │  WSS (TLS)                    WSS (TLS)     │                    │
│          │                                             │                    │
│          └────────────────┬────────────────────────────┘                    │
│                           │                                                  │
│                    ┌──────▼──────┐                                          │
│                    │   Relay     │                                          │
│                    │   Server    │                                          │
│                    │  (Stateless)│                                          │
│                    └─────────────┘                                          │
│                                                                              │
│   Security Model:                                                           │
│   - E2E encryption (relay cannot read messages)                             │
│   - Pairing via QR code                                                     │
│   - Session-based authentication                                            │
│   - No persistent storage on relay                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### No SSH - WebSocket RPC

Happy deliberately avoids SSH in favor of WebSocket-based RPC:

| Aspect | SSH Approach | Happy's WebSocket Approach |
|--------|--------------|---------------------------|
| Transport | TCP + SSH protocol | WebSocket over HTTPS |
| Auth | Keys/passwords | QR code + E2E crypto |
| NAT traversal | Requires port forwarding | Relay handles NAT |
| Mobile-friendly | Requires SSH client | Native WebSocket |
| Real-time | Requires persistent connection | Built-in WebSocket |
| Firewall | Often blocked | Uses HTTPS (443) |

---

## End-to-End Encryption

### Key Exchange Protocol

```typescript
// Based on Signal Protocol / X3DH (Extended Triple Diffie-Hellman)
interface KeyBundle {
  identityKey: CryptoKeyPair;        // Long-term identity
  signedPreKey: SignedPreKey;         // Medium-term signed key
  oneTimePreKeys: CryptoKeyPair[];    // Ephemeral keys (consumed on use)
}

interface SignedPreKey {
  keyPair: CryptoKeyPair;
  signature: ArrayBuffer;             // Signed by identity key
  timestamp: number;
}

class X3DHKeyExchange {
  private identityKey: CryptoKeyPair;
  private signedPreKey: SignedPreKey;
  private oneTimePreKeys: Map<string, CryptoKeyPair> = new Map();

  async generateKeyBundle(): Promise<KeyBundle> {
    // 1. Generate identity key (Ed25519 for signing, X25519 for DH)
    this.identityKey = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey']
    );

    // 2. Generate signed pre-key (rotated periodically)
    const preKey = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey']
    );

    const publicKeyData = await crypto.subtle.exportKey('raw', preKey.publicKey);
    const signature = await this.sign(publicKeyData);

    this.signedPreKey = {
      keyPair: preKey,
      signature,
      timestamp: Date.now(),
    };

    // 3. Generate one-time pre-keys (consumed on first contact)
    const oneTimePreKeys: CryptoKeyPair[] = [];
    for (let i = 0; i < 100; i++) {
      const otpk = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey']
      );
      oneTimePreKeys.push(otpk);
      this.oneTimePreKeys.set(await this.keyId(otpk.publicKey), otpk);
    }

    return {
      identityKey: this.identityKey,
      signedPreKey: this.signedPreKey,
      oneTimePreKeys,
    };
  }

  async initiateKeyExchange(recipientBundle: PublicKeyBundle): Promise<SharedSecret> {
    // X3DH key agreement
    // DH1 = DH(IKa, SPKb)  - Our identity, their signed pre-key
    // DH2 = DH(EKa, IKb)   - Our ephemeral, their identity
    // DH3 = DH(EKa, SPKb)  - Our ephemeral, their signed pre-key
    // DH4 = DH(EKa, OPKb)  - Our ephemeral, their one-time (if available)

    const ephemeralKey = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey']
    );

    const dh1 = await this.dh(this.identityKey.privateKey, recipientBundle.signedPreKey);
    const dh2 = await this.dh(ephemeralKey.privateKey, recipientBundle.identityKey);
    const dh3 = await this.dh(ephemeralKey.privateKey, recipientBundle.signedPreKey);

    let dhResults = [dh1, dh2, dh3];

    if (recipientBundle.oneTimePreKey) {
      const dh4 = await this.dh(ephemeralKey.privateKey, recipientBundle.oneTimePreKey);
      dhResults.push(dh4);
    }

    // Derive shared secret
    const sharedSecret = await this.kdf(this.concat(...dhResults));

    return {
      key: sharedSecret,
      ephemeralPublicKey: ephemeralKey.publicKey,
      usedOneTimePreKeyId: recipientBundle.oneTimePreKeyId,
    };
  }
}
```

### Double Ratchet Protocol

```typescript
// Provides forward secrecy and break-in recovery
interface RatchetState {
  rootKey: CryptoKey;
  sendingChainKey: CryptoKey;
  receivingChainKey: CryptoKey;
  sendingRatchetKey: CryptoKeyPair;
  receivingRatchetKey: CryptoKey;
  sendingCounter: number;
  receivingCounter: number;
  previousSendingChainLength: number;
  skippedMessageKeys: Map<string, CryptoKey>;
}

class DoubleRatchet {
  private state: RatchetState;

  async ratchetEncrypt(plaintext: string): Promise<EncryptedMessage> {
    // Derive message key from chain
    const { messageKey, newChainKey } = await this.chainKeyStep(this.state.sendingChainKey);
    this.state.sendingChainKey = newChainKey;

    // Encrypt message
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      messageKey,
      new TextEncoder().encode(plaintext)
    );

    const message: EncryptedMessage = {
      header: {
        publicKey: await crypto.subtle.exportKey('raw', this.state.sendingRatchetKey.publicKey),
        previousChainLength: this.state.previousSendingChainLength,
        messageNumber: this.state.sendingCounter,
      },
      ciphertext: new Uint8Array(ciphertext),
      iv,
    };

    this.state.sendingCounter++;

    return message;
  }

  async ratchetDecrypt(message: EncryptedMessage): Promise<string> {
    // Check if we need to perform a DH ratchet step
    const senderPublicKey = await crypto.subtle.importKey(
      'raw',
      message.header.publicKey,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      []
    );

    if (!await this.keysEqual(senderPublicKey, this.state.receivingRatchetKey)) {
      // Perform DH ratchet
      await this.dhRatchet(senderPublicKey);
    }

    // Skip any missed messages (store keys for later)
    await this.skipMessageKeys(message.header.messageNumber);

    // Derive message key
    const { messageKey, newChainKey } = await this.chainKeyStep(this.state.receivingChainKey);
    this.state.receivingChainKey = newChainKey;
    this.state.receivingCounter++;

    // Decrypt
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: message.iv },
      messageKey,
      message.ciphertext
    );

    return new TextDecoder().decode(plaintext);
  }

  private async dhRatchet(senderPublicKey: CryptoKey): Promise<void> {
    // Store old receiving chain state
    this.state.previousSendingChainLength = this.state.sendingCounter;

    // Update receiving ratchet key
    this.state.receivingRatchetKey = senderPublicKey;

    // Derive new receiving chain key
    const dhOutput = await this.dh(this.state.sendingRatchetKey.privateKey, senderPublicKey);
    const { rootKey, chainKey } = await this.rootKeyKdf(this.state.rootKey, dhOutput);
    this.state.rootKey = rootKey;
    this.state.receivingChainKey = chainKey;
    this.state.receivingCounter = 0;

    // Generate new sending ratchet key
    this.state.sendingRatchetKey = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey']
    );

    // Derive new sending chain key
    const dhOutput2 = await this.dh(this.state.sendingRatchetKey.privateKey, senderPublicKey);
    const { rootKey: rk2, chainKey: ck2 } = await this.rootKeyKdf(this.state.rootKey, dhOutput2);
    this.state.rootKey = rk2;
    this.state.sendingChainKey = ck2;
    this.state.sendingCounter = 0;
  }
}
```

---

## Pairing Protocol

### QR Code Pairing

```typescript
interface PairingData {
  deviceId: string;
  sessionId: string;
  publicKey: string;          // Base64 encoded
  relayUrl: string;
  timestamp: number;
  signature: string;          // Proves desktop owns the key
}

class PairingService {
  async generatePairingCode(): Promise<{ qrData: string; pairingData: PairingData }> {
    const sessionId = randomUUID();
    const publicKeyData = await crypto.subtle.exportKey('raw', this.keyBundle.identityKey.publicKey);

    const pairingData: PairingData = {
      deviceId: this.deviceId,
      sessionId,
      publicKey: btoa(String.fromCharCode(...new Uint8Array(publicKeyData))),
      relayUrl: this.relayUrl,
      timestamp: Date.now(),
      signature: '', // Will be set below
    };

    // Sign the pairing data (proves we own the key)
    const dataToSign = JSON.stringify({ ...pairingData, signature: undefined });
    pairingData.signature = await this.sign(dataToSign);

    // Generate QR code data
    const qrData = `happy://${btoa(JSON.stringify(pairingData))}`;

    // Wait for mobile to connect
    this.waitForPairing(sessionId);

    return { qrData, pairingData };
  }

  async completePairing(mobilePublicKey: CryptoKey, sessionId: string): Promise<PairedSession> {
    // Verify mobile responded to our session
    // Perform key exchange
    const sharedSecret = await this.keyExchange.initiateKeyExchange({
      identityKey: mobilePublicKey,
      // ... rest of mobile's key bundle
    });

    // Initialize double ratchet
    const ratchet = new DoubleRatchet();
    await ratchet.initialize(sharedSecret);

    return {
      sessionId,
      ratchet,
      pairedAt: new Date(),
      deviceName: 'Mobile Device',
    };
  }
}
```

### Session Management

```typescript
interface PairedSession {
  sessionId: string;
  ratchet: DoubleRatchet;
  pairedAt: Date;
  lastActivity: Date;
  deviceName: string;
  deviceType: 'mobile' | 'desktop' | 'web';
}

class SessionManager {
  private sessions: Map<string, PairedSession> = new Map();
  private storage: SecureStorage;

  async persistSession(session: PairedSession): Promise<void> {
    // Serialize ratchet state
    const serialized = {
      sessionId: session.sessionId,
      deviceName: session.deviceName,
      pairedAt: session.pairedAt.toISOString(),
      ratchetState: await this.serializeRatchetState(session.ratchet),
    };

    // Encrypt before storing
    const encrypted = await this.encryptForStorage(JSON.stringify(serialized));

    await this.storage.set(`session:${session.sessionId}`, encrypted);
  }

  async restoreSessions(): Promise<void> {
    const keys = await this.storage.keys('session:*');

    for (const key of keys) {
      try {
        const encrypted = await this.storage.get(key);
        const decrypted = await this.decryptFromStorage(encrypted);
        const data = JSON.parse(decrypted);

        const ratchet = new DoubleRatchet();
        await ratchet.restore(data.ratchetState);

        this.sessions.set(data.sessionId, {
          sessionId: data.sessionId,
          ratchet,
          pairedAt: new Date(data.pairedAt),
          lastActivity: new Date(),
          deviceName: data.deviceName,
          deviceType: 'mobile',
        });
      } catch (error) {
        // Session corrupted, remove it
        await this.storage.delete(key);
      }
    }
  }
}
```

---

## WebSocket Relay Server

### Stateless Architecture

```typescript
// The relay is deliberately stateless - no message storage
interface RelayMessage {
  type: 'route' | 'presence' | 'ping';
  from: string;           // Device ID
  to: string;             // Target device ID
  payload: ArrayBuffer;   // Encrypted, relay cannot read
  timestamp: number;
}

class RelayServer {
  private connections: Map<string, WebSocket> = new Map();

  handleConnection(ws: WebSocket, deviceId: string): void {
    this.connections.set(deviceId, ws);

    // Broadcast presence
    this.broadcastPresence(deviceId, 'online');

    ws.on('message', (data) => {
      const message: RelayMessage = this.parseMessage(data);

      switch (message.type) {
        case 'route':
          this.routeMessage(message);
          break;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
      }
    });

    ws.on('close', () => {
      this.connections.delete(deviceId);
      this.broadcastPresence(deviceId, 'offline');
    });
  }

  private routeMessage(message: RelayMessage): void {
    const targetWs = this.connections.get(message.to);

    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
      // Forward encrypted payload (relay cannot decrypt)
      targetWs.send(JSON.stringify({
        type: 'message',
        from: message.from,
        payload: message.payload, // Still encrypted
        timestamp: message.timestamp,
      }));
    } else {
      // Target offline - notify sender
      const senderWs = this.connections.get(message.from);
      if (senderWs) {
        senderWs.send(JSON.stringify({
          type: 'delivery-failed',
          to: message.to,
          reason: 'offline',
        }));
      }
    }
  }

  private broadcastPresence(deviceId: string, status: 'online' | 'offline'): void {
    // Only broadcast to paired devices (determined by session data)
    // The relay doesn't know who is paired - clients filter based on known peers
    for (const [id, ws] of this.connections) {
      if (id !== deviceId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'presence',
          deviceId,
          status,
          timestamp: Date.now(),
        }));
      }
    }
  }
}
```

### Relay Scalability

```typescript
// Redis-backed relay for horizontal scaling
class ScalableRelay {
  private redis: Redis;
  private pubsub: Redis;
  private localConnections: Map<string, WebSocket> = new Map();

  async handleConnection(ws: WebSocket, deviceId: string): Promise<void> {
    this.localConnections.set(deviceId, ws);

    // Register device in Redis (with TTL for cleanup)
    await this.redis.setex(`device:${deviceId}`, 300, this.nodeId);

    // Subscribe to messages for this device
    await this.pubsub.subscribe(`messages:${deviceId}`);

    ws.on('message', (data) => {
      const message = this.parseMessage(data);

      if (message.type === 'route') {
        // Publish to Redis for cross-node routing
        this.redis.publish(`messages:${message.to}`, JSON.stringify({
          from: message.from,
          payload: message.payload,
        }));
      }
    });

    ws.on('close', () => {
      this.localConnections.delete(deviceId);
      this.redis.del(`device:${deviceId}`);
      this.pubsub.unsubscribe(`messages:${deviceId}`);
    });
  }

  constructor() {
    // Handle cross-node messages
    this.pubsub.on('message', (channel, message) => {
      const deviceId = channel.replace('messages:', '');
      const ws = this.localConnections.get(deviceId);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }
}
```

---

## RPC Protocol

### Command Messages

```typescript
interface RPCMessage {
  id: string;               // For request/response correlation
  type: 'request' | 'response' | 'event';
  method?: string;          // For requests
  params?: any;             // For requests
  result?: any;             // For responses
  error?: RPCError;         // For error responses
}

interface RPCError {
  code: number;
  message: string;
  data?: any;
}

// Available RPC methods
type RPCMethods = {
  // Claude Code control
  'claude.sendMessage': { prompt: string } => { messageId: string };
  'claude.cancel': {} => { success: boolean };
  'claude.getStatus': {} => ClaudeStatus;

  // Terminal control
  'terminal.write': { data: string } => void;
  'terminal.resize': { cols: number; rows: number } => void;

  // File operations
  'file.read': { path: string } => { content: string };
  'file.write': { path: string; content: string } => { success: boolean };
  'file.list': { path: string } => { files: FileEntry[] };

  // Git operations
  'git.status': {} => GitStatus;
  'git.commit': { message: string } => { sha: string };
  'git.push': {} => { success: boolean };

  // Session control
  'session.pause': {} => { pauseId: string };
  'session.resume': { pauseId: string } => { success: boolean };
};
```

### RPC Client Implementation

```typescript
class RPCClient {
  private ratchet: DoubleRatchet;
  private ws: WebSocket;
  private pendingRequests: Map<string, { resolve: Function; reject: Function }> = new Map();

  async call<M extends keyof RPCMethods>(
    method: M,
    params: Parameters<RPCMethods[M]>[0]
  ): Promise<ReturnType<RPCMethods[M]>> {
    const id = randomUUID();

    const message: RPCMessage = {
      id,
      type: 'request',
      method,
      params,
    };

    // Encrypt with double ratchet
    const encrypted = await this.ratchet.ratchetEncrypt(JSON.stringify(message));

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);

      // Send via relay
      this.ws.send(JSON.stringify({
        type: 'route',
        to: this.peerId,
        payload: encrypted,
      }));
    });
  }

  private async handleMessage(encrypted: EncryptedMessage): Promise<void> {
    const decrypted = await this.ratchet.ratchetDecrypt(encrypted);
    const message: RPCMessage = JSON.parse(decrypted);

    if (message.type === 'response') {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(new RPCError(message.error));
        } else {
          pending.resolve(message.result);
        }
      }
    } else if (message.type === 'event') {
      this.emit(message.method!, message.params);
    }
  }
}
```

---

## Mobile App Architecture

### React Native Implementation

```typescript
// apps/mobile/src/services/RemoteControl.ts
class RemoteControl {
  private rpcClient: RPCClient;
  private sessionManager: SessionManager;

  async connect(sessionId: string): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId);

    this.rpcClient = new RPCClient({
      relayUrl: session.relayUrl,
      deviceId: this.deviceId,
      peerId: session.desktopDeviceId,
      ratchet: session.ratchet,
    });

    await this.rpcClient.connect();

    // Subscribe to events
    this.rpcClient.on('claude.output', (data) => {
      this.emit('output', data);
    });

    this.rpcClient.on('terminal.data', (data) => {
      this.emit('terminalData', data);
    });
  }

  async sendPrompt(prompt: string): Promise<string> {
    return this.rpcClient.call('claude.sendMessage', { prompt });
  }

  async getStatus(): Promise<ClaudeStatus> {
    return this.rpcClient.call('claude.getStatus', {});
  }

  async cancelOperation(): Promise<boolean> {
    const result = await this.rpcClient.call('claude.cancel', {});
    return result.success;
  }
}
```

### Offline Support

```typescript
// Queue commands when offline, sync when reconnected
class OfflineQueue {
  private queue: QueuedCommand[] = [];
  private storage: AsyncStorage;

  async enqueue(command: RPCMessage): Promise<string> {
    const id = randomUUID();

    const queued: QueuedCommand = {
      id,
      command,
      queuedAt: Date.now(),
      status: 'pending',
    };

    this.queue.push(queued);
    await this.persist();

    return id;
  }

  async processQueue(rpcClient: RPCClient): Promise<void> {
    const pending = this.queue.filter(q => q.status === 'pending');

    for (const item of pending) {
      try {
        item.status = 'processing';
        await this.persist();

        const result = await rpcClient.call(
          item.command.method as any,
          item.command.params
        );

        item.status = 'completed';
        item.result = result;
      } catch (error) {
        item.status = 'failed';
        item.error = error.message;
      }

      await this.persist();
    }

    // Cleanup completed items older than 24h
    this.queue = this.queue.filter(
      q => q.status !== 'completed' || Date.now() - q.queuedAt < 86400000
    );
    await this.persist();
  }
}
```

---

## Security Model

### Threat Model

| Threat | Mitigation |
|--------|------------|
| Relay reads messages | E2E encryption (relay sees only ciphertext) |
| Relay stores messages | Stateless design (no persistence) |
| MITM attack | X3DH key exchange + signature verification |
| Replay attack | Message counters in Double Ratchet |
| Key compromise | Forward secrecy via ratcheting |
| Device loss | Session revocation via device management |

### Session Revocation

```typescript
class SecurityManager {
  async revokeSession(sessionId: string): Promise<void> {
    // 1. Remove local session data
    await this.sessionManager.deleteSession(sessionId);

    // 2. Notify paired device (if reachable)
    try {
      await this.rpcClient.call('session.revoke', { sessionId });
    } catch {
      // Device offline, will fail to decrypt future messages anyway
    }

    // 3. Update key bundle (consume compromised pre-keys)
    await this.keyManager.rotateKeys();
  }

  async revokeAllSessions(): Promise<void> {
    const sessions = await this.sessionManager.getAllSessions();

    for (const session of sessions) {
      await this.revokeSession(session.sessionId);
    }

    // Generate completely new key bundle
    await this.keyManager.regenerateKeyBundle();
  }
}
```

---

## UX Considerations

### Pairing Flow (Mobile)

```
1. Open Happy mobile app
2. Tap "Add Device"
3. Point camera at QR code on desktop
4. Automatic key exchange (< 1 second)
5. Name the device ("Work Laptop")
6. Connected - start controlling Claude
```

### Pairing Flow (Desktop)

```
1. Open Happy desktop app
2. Click "Pair Mobile Device"
3. QR code appears with countdown
4. Wait for mobile scan
5. Confirm pairing request
6. Device appears in paired list
```

### Connection Status UI

```
┌─────────────────────────────────────────┐
│  Happy Remote                           │
├─────────────────────────────────────────┤
│                                          │
│  Work Laptop              🟢 Online     │
│  Last activity: 2 minutes ago           │
│                                          │
│  [Send Message] [View Terminal]         │
│                                          │
│  ─────────────────────────────────────  │
│                                          │
│  Personal Mac            🔴 Offline     │
│  Last seen: 3 hours ago                 │
│                                          │
│  [Remove Device]                        │
│                                          │
└─────────────────────────────────────────┘
```

---

## Performance Optimizations

### Message Batching

```typescript
class MessageBatcher {
  private batch: RPCMessage[] = [];
  private flushTimer: NodeJS.Timer | null = null;

  async add(message: RPCMessage): Promise<void> {
    this.batch.push(message);

    if (this.batch.length >= 10) {
      // Batch full, flush immediately
      await this.flush();
    } else if (!this.flushTimer) {
      // Start flush timer (50ms max delay)
      this.flushTimer = setTimeout(() => this.flush(), 50);
    }
  }

  private async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.batch.length === 0) return;

    const batch = this.batch;
    this.batch = [];

    // Single encryption for whole batch
    const encrypted = await this.ratchet.ratchetEncrypt(
      JSON.stringify({ type: 'batch', messages: batch })
    );

    this.ws.send(JSON.stringify({
      type: 'route',
      to: this.peerId,
      payload: encrypted,
    }));
  }
}
```

### Connection Keepalive

```typescript
class ConnectionManager {
  private pingInterval: NodeJS.Timer;
  private lastPong: number = Date.now();

  startKeepalive(): void {
    this.pingInterval = setInterval(() => {
      if (Date.now() - this.lastPong > 60000) {
        // No pong for 60 seconds, reconnect
        this.reconnect();
        return;
      }

      this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
    }, 15000); // Ping every 15 seconds
  }

  handlePong(): void {
    this.lastPong = Date.now();
  }

  async reconnect(): Promise<void> {
    this.ws.close();

    // Exponential backoff
    await sleep(this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, 30000);

    await this.connect();
    this.backoffMs = 1000; // Reset on success
  }
}
```

---

## Key Patterns for Superset

1. **Relay-based architecture** - NAT-friendly, no port forwarding required
2. **E2E encryption** - Relay cannot read messages, true security
3. **QR code pairing** - Frictionless device pairing UX
4. **Double Ratchet** - Forward secrecy and break-in recovery
5. **Stateless relay** - Horizontal scaling, no message storage
6. **RPC protocol** - Type-safe remote procedure calls
7. **Offline queue** - Commands queued when disconnected
8. **Session persistence** - Survive app restarts without re-pairing
