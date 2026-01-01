# Catnip Container & Cloud Architecture - Deep Technical Analysis

## Overview

Catnip implements the **most comprehensive containerized development environment** among all competitors. Built by Weights & Biases, it provides Docker-based isolation with SSH access, port forwarding, and cloud deployment capabilities.

**Key Files**:
- `container/Dockerfile` (360 lines)
- `container/internal/services/container.go`
- `container/internal/tui/port_forwarder.go`
- `container/setup/entrypoint.sh`
- `container/internal/services/codespace.go`

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CATNIP ARCHITECTURE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     HOST MACHINE                                     │   │
│   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │   │
│   │  │ Catnip TUI   │  │ VS Code      │  │ Cursor       │               │   │
│   │  │ (Go CLI)     │  │ Remote-SSH   │  │ Remote-SSH   │               │   │
│   │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │   │
│   │         │                  │                  │                      │   │
│   │         └──────────────────┼──────────────────┘                      │   │
│   │                            │ SSH (port 2222)                         │   │
│   │                            ▼                                         │   │
│   └────────────────────────────┼─────────────────────────────────────────┘   │
│                                │                                              │
│   ┌────────────────────────────▼─────────────────────────────────────────┐   │
│   │                     DOCKER CONTAINER                                  │   │
│   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │   │
│   │  │ SSH Server   │  │ Catnip Serve │  │ Claude Code  │               │   │
│   │  │ (port 2222)  │  │ (port 6369)  │  │ (terminal)   │               │   │
│   │  └──────────────┘  └──────────────┘  └──────────────┘               │   │
│   │                                                                      │   │
│   │  ┌──────────────────────────────────────────────────────────────┐   │   │
│   │  │ Development Environment                                       │   │   │
│   │  │ - Node 22.17.0  - Python 3.13.5  - Go 1.25.4  - Rust 1.88.0 │   │   │
│   │  │ - Docker CLI (DinD support)                                   │   │   │
│   │  └──────────────────────────────────────────────────────────────┘   │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Container Runtime Abstraction

### Multi-Runtime Support

```go
type ContainerRuntime string

const (
    RuntimeDocker    ContainerRuntime = "docker"      // Docker CLI
    RuntimeApple     ContainerRuntime = "container"   // Apple Container SDK
    RuntimeCodespace ContainerRuntime = "codespace"   // GitHub Codespaces
)
```

### Container Service Interface

```go
type ContainerService interface {
    Create(workspace *Workspace) error
    Start(workspace *Workspace) error
    Stop(workspace *Workspace) error
    Delete(workspace *Workspace) error
    Exec(workspace *Workspace, cmd string) (string, error)
    Logs(workspace *Workspace) (io.ReadCloser, error)
}
```

---

## Docker Implementation

### Multi-Stage Dockerfile

```dockerfile
# Stage 1: Frontend Builder
FROM node:22-alpine AS frontend-builder
WORKDIR /build
COPY container/web/package.json ./
RUN npm install
COPY container/web/ ./
RUN npm run build

# Stage 2: Go Backend Builder
FROM golang:1.25 AS go-builder
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o catnip ./container/cmd/catnip

# Stage 3: Runtime
FROM ubuntu:24.04

# Install language runtimes
ENV NODE_VERSION=22.17.0
ENV PYTHON_VERSION=3.13.5
ENV GO_VERSION=1.25.4
ENV RUST_VERSION=1.88.0

# Install SSH server
RUN apt-get update && apt-get install -y \
    openssh-server openssh-client \
    gosu socat \
    git vim nano jq htop strace tcpdump

# Copy built artifacts
COPY --from=frontend-builder /build/dist /srv/static
COPY --from=go-builder /build/catnip /usr/local/bin/catnip
COPY container/setup/entrypoint.sh /entrypoint.sh

EXPOSE 2222 6369
ENTRYPOINT ["/entrypoint.sh"]
```

### Resource Limits

```go
func buildDockerArgs(config *ContainerConfig) []string {
    args := []string{
        "--cpus", "2.5",
        "--memory", "4294967296",  // 4GB in bytes
    }

    // Apple Container SDK uses different format
    if runtime == RuntimeApple {
        args = []string{
            "--cpus", "2",
            "--memory", "4G",
        }
    }

    return args
}
```

---

## SSH Server Implementation

### SSH Configuration

```bash
# /etc/ssh/sshd_config (from entrypoint.sh)

Port 2222
PubkeyAuthentication yes
PasswordAuthentication no
PermitUserEnvironment yes
AllowUsers ${ACTUAL_USERNAME} catnip
X11Forwarding yes
Subsystem sftp /usr/lib/openssh/sftp-server
AuthorizedKeysFile /home/catnip/.ssh/authorized_keys
```

### Host Key Generation

```bash
# Generate SSH host keys if missing
for keytype in rsa ecdsa ed25519; do
    keyfile="/etc/ssh/ssh_host_${keytype}_key"
    if [ ! -f "$keyfile" ]; then
        ssh-keygen -t $keytype -f $keyfile -N ""
    fi
done
```

### SSH Key Management

```go
// Mount SSH public key from host
func mountSSHKey(args *[]string) {
    pubKeyPath := filepath.Join(os.Getenv("HOME"), ".ssh", "catnip_remote.pub")

    if _, err := os.Stat(pubKeyPath); err == nil {
        // Mount as authorized_keys
        *args = append(*args,
            "-v", fmt.Sprintf("%s:/home/catnip/.ssh/authorized_keys:ro", pubKeyPath),
        )
    }
}
```

---

## Port Forwarding Architecture

### SSH Tunnel-Based Port Forwarding

```go
type PortForwardManager struct {
    backendBaseURL string
    sshUser        string
    sshAddress     string              // 127.0.0.1:2222
    keyPath        string              // ~/.ssh/catnip_remote
    client         *ssh.Client
    forwards       map[int]*activeForward
    httpClient     *http.Client
}

type activeForward struct {
    containerPort int
    hostPort      int
    listener      net.Listener
    cancel        context.CancelFunc
}
```

### Connection Establishment

```go
func (m *PortForwardManager) ensureSSH() error {
    if m.client != nil {
        return nil
    }

    // Read private key
    keyBytes, err := os.ReadFile(m.keyPath)
    if err != nil {
        return fmt.Errorf("failed to read SSH key: %w", err)
    }

    // Parse key (supports OpenSSH and PEM formats)
    signer, err := ssh.ParsePrivateKey(keyBytes)
    if err != nil {
        return fmt.Errorf("failed to parse SSH key: %w", err)
    }

    // Connect to container SSH
    config := &ssh.ClientConfig{
        User: m.sshUser,
        Auth: []ssh.AuthMethod{
            ssh.PublicKeys(signer),
        },
        HostKeyCallback: ssh.InsecureIgnoreHostKey(), // Dev convenience
        Timeout:         10 * time.Second,
    }

    m.client, err = ssh.Dial("tcp", m.sshAddress, config)
    return err
}
```

### Port Forward Flow

```go
func (m *PortForwardManager) Forward(containerPort, hostPort int) error {
    // 1. Ensure SSH connection
    if err := m.ensureSSH(); err != nil {
        return err
    }

    // 2. Create local listener
    listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", hostPort))
    if err != nil {
        return fmt.Errorf("failed to listen on port %d: %w", hostPort, err)
    }

    // 3. Accept connections and tunnel
    go m.acceptLoop(listener, containerPort)

    m.forwards[containerPort] = &activeForward{
        containerPort: containerPort,
        hostPort:      hostPort,
        listener:      listener,
    }

    return nil
}

func (m *PortForwardManager) acceptLoop(listener net.Listener, containerPort int) {
    for {
        conn, err := listener.Accept()
        if err != nil {
            return
        }

        // Establish SSH tunnel to container port
        remote, err := m.client.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", containerPort))
        if err != nil {
            conn.Close()
            continue
        }

        // Bidirectional copy
        go io.Copy(remote, conn)
        go io.Copy(conn, remote)
    }
}
```

### Dynamic Port Discovery

```go
func (m *PortForwardManager) FindAvailablePort(preferred int) int {
    // Reserved ports
    reserved := map[int]bool{
        6369: true,  // Catnip server
        2222: true,  // SSH
    }

    if !reserved[preferred] && isPortAvailable(preferred) {
        return preferred
    }

    // Scan port ranges
    ranges := []struct{ start, end int }{
        {3000, 3999},
        {4000, 4999},
        {5000, 5999},
        {8000, 8999},
    }

    for _, r := range ranges {
        for port := r.start; port <= r.end; port++ {
            if !reserved[port] && isPortAvailable(port) {
                return port
            }
        }
    }

    return 0
}
```

---

## Docker-in-Docker Support

### Socket Proxying with socat

```bash
# entrypoint.sh - Docker socket detection and proxying

# Check for Docker socket
DOCKER_SOCKET=""
for sock in /var/run/docker.sock /var/run/docker-host.sock /run/docker.sock; do
    if [ -S "$sock" ]; then
        DOCKER_SOCKET="$sock"
        break
    fi
done

if [ -n "$DOCKER_SOCKET" ]; then
    PROXY_PATH="/var/run/docker.sock"

    # Create proxy socket with proper permissions
    socat "UNIX-LISTEN:$PROXY_PATH,fork,mode=660,user=1000,group=999" \
          "UNIX-CONNECT:$DOCKER_SOCKET" &

    # Add user to docker group
    usermod -aG docker catnip
fi
```

### Docker Group Matching

```bash
# Match Docker GID from host
HOST_DOCKER_GID=$(stat -c '%g' "$DOCKER_SOCKET")
groupmod -g "$HOST_DOCKER_GID" docker 2>/dev/null || true
```

---

## GitHub Codespaces Integration

### Codespace Service

```go
type CodespaceService struct {
    ghPath string
}

func (s *CodespaceService) List() ([]Codespace, error) {
    output, err := exec.Command(s.ghPath, "codespace", "list", "--json",
        "name,repository,branch,state").Output()
    if err != nil {
        return nil, err
    }

    var codespaces []Codespace
    json.Unmarshal(output, &codespaces)
    return codespaces, nil
}

func (s *CodespaceService) Create(repo, branch string) (*Codespace, error) {
    output, err := exec.Command(s.ghPath, "codespace", "create",
        "--repo", repo,
        "--branch", branch,
        "--json").Output()
    // ...
}

func (s *CodespaceService) SSH(name, cmd string) (string, error) {
    return exec.Command(s.ghPath, "codespace", "ssh",
        "--codespace", name,
        "--", "bash", "-c", cmd).Output()
}
```

### Daemon Management in Codespaces

```go
func (s *CodespaceService) EnsureDaemon(name string, token string) error {
    // Check if daemon running
    output, _ := s.SSH(name, "pgrep -f 'catnip serve'")
    if output != "" {
        return nil // Already running
    }

    // Install catnip if needed
    _, err := s.SSH(name, "which catnip")
    if err != nil {
        // Install from script
        _, err = s.SSH(name, "curl -sSfL install.catnip.sh | sh")
        if err != nil {
            return err
        }
    }

    // Start daemon
    _, err = s.SSH(name, fmt.Sprintf(
        "nohup env GITHUB_TOKEN=%q catnip serve --port 6369 > /tmp/catnip.log 2>&1 &",
        token,
    ))
    return err
}
```

---

## Cloudflare Workers Deployment

### Infrastructure Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE DEPLOYMENT                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                   │
│   │  Cloudflare  │   │  Cloudflare  │   │  Cloudflare  │                   │
│   │  Workers     │   │  Containers  │   │  KV Storage  │                   │
│   └──────────────┘   └──────────────┘   └──────────────┘                   │
│          │                  │                  │                            │
│          └──────────────────┼──────────────────┘                            │
│                             │                                               │
│   ┌─────────────────────────▼───────────────────────────────────────────┐  │
│   │                     DURABLE OBJECTS                                  │  │
│   │  - Session state management                                          │  │
│   │  - WebSocket connection handling                                     │  │
│   │  - Container lifecycle orchestration                                 │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Container Limits

- **Max instances**: 40
- **Idle timeout**: 10 minutes
- **Memory**: 4GB per container
- **CPU**: 2.5 vCPUs

### Deployment Pipeline

```bash
# Push container image
docker pull ghcr.io/wandb/catnip:0.1.0
wrangler containers push ghcr.io/wandb/catnip:0.1.0

# Deploy workers
wrangler deploy --env production
```

---

## Volume Management

### Persistent Volumes

```go
func buildVolumeMounts(config *ContainerConfig) []string {
    mounts := []string{}

    // Persistent volume
    mounts = append(mounts,
        "-v", fmt.Sprintf("%s:/volume", filepath.Join(homeDir, ".catnip", "volume")),
    )

    // Claude IDE config
    mounts = append(mounts,
        "-v", fmt.Sprintf("%s:/volume/.claude/ide", filepath.Join(homeDir, ".claude", "ide")),
    )

    // Git repository (live mount)
    mounts = append(mounts,
        "-v", fmt.Sprintf("%s:/live/%s", gitRoot, repoName),
    )

    return mounts
}
```

### Development Mode Volumes

```go
// Named volume for node_modules (faster npm install)
"-v", "catnip-dev-node-modules:/live/catnip/node_modules"
```

---

## Security Model

### Non-Root Execution

```bash
# entrypoint.sh - User setup

# Create catnip user
useradd -m -s /bin/bash -u 1000 catnip

# Set up sudo if needed
echo "catnip ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/catnip

# Drop privileges
exec gosu catnip "$@"
```

### File Permissions

```bash
# SSH directory permissions
mkdir -p /home/catnip/.ssh
chmod 700 /home/catnip/.ssh
chmod 600 /home/catnip/.ssh/authorized_keys
chown -R catnip:catnip /home/catnip/.ssh
```

### Socket Proxy Security

```bash
# Create socket with restricted permissions
socat "UNIX-LISTEN:$PROXY_PATH,fork,mode=660,user=1000,group=999" ...
```

---

## HTTP Proxy for Port Forwarding

### URL Rewriting Strategy

```go
type ProxyHandler struct {
    targetPort int
}

func (h *ProxyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    // Rewrite localhost URLs in HTML responses
    target := fmt.Sprintf("http://localhost:%d%s", h.targetPort, r.URL.Path)

    resp, err := http.Get(target)
    if err != nil {
        http.Error(w, err.Error(), http.StatusBadGateway)
        return
    }
    defer resp.Body.Close()

    // Handle gzip decompression
    body := resp.Body
    if resp.Header.Get("Content-Encoding") == "gzip" {
        body, _ = gzip.NewReader(resp.Body)
    }

    // Rewrite URLs in HTML
    content, _ := io.ReadAll(body)
    content = bytes.ReplaceAll(content,
        []byte(fmt.Sprintf("http://localhost:%d", h.targetPort)),
        []byte(fmt.Sprintf("/proxy/%d", h.targetPort)),
    )

    w.Write(content)
}
```

---

## UX Considerations

### IDE Integration

Supports multiple IDEs via SSH:
- **VS Code**: `code --remote ssh-remote+catnip /workspace`
- **Cursor**: `cursor --remote ssh-remote+catnip /workspace`
- **JetBrains**: SSH configuration in IDE settings

### SSH Config Generation

```go
func generateSSHConfig() string {
    return `
Host catnip
    HostName 127.0.0.1
    Port 2222
    User catnip
    IdentityFile ~/.ssh/catnip_remote
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
`
}
```

### Mobile Access

- Native iOS app (TestFlight)
- Responsive web UI
- Touch-optimized controls

---

## Why This Implementation Excels

### Strengths

1. **Complete isolation**: Docker containers with resource limits
2. **Multi-IDE support**: SSH-based access for any SSH-capable editor
3. **Port forwarding**: Automatic service discovery and tunneling
4. **Cloud deployment ready**: Cloudflare Workers + Containers
5. **Docker-in-Docker**: Full Docker access inside container
6. **Multi-runtime**: Docker, Apple Container SDK, GitHub Codespaces
7. **Production hardened**: Non-root execution, proper permissions

### Trade-offs

1. **Docker dependency**: Requires Docker installed on host
2. **Complexity**: Many moving parts (SSH, proxy, DinD)
3. **Resource overhead**: Container + SSH server overhead
4. **macOS/Linux focus**: Limited Windows support

---

## Key Patterns for Superset

1. **SSH server in container** - Enables any SSH-capable editor
2. **Port forwarding via SSH tunnels** - Reliable service access
3. **Docker socket proxying** - DinD without direct socket access
4. **Multi-runtime abstraction** - Support Docker + alternatives
5. **Non-root execution** - Security best practice
6. **Volume persistence** - Survive container restarts
7. **Cloud deployment architecture** - Cloudflare Workers model
