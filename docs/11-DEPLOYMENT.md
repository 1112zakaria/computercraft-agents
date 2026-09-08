# Deployment

## 1. Operational constraints

- User controls the VPS.
- Friend operates the Ubuntu 24 Minecraft server.
- User does not expect SSH/RDP/filesystem access to the friend's host.
- Friend is willing to install required components manually.
- Setup/update therefore SHOULD be simple, Git-based, and explicit.

## 2. Repository layout

Recommended monorepo:

```text
minecraft-agents/
  README.md
  AGENTS.md
  docs/
  apps/
    control-plane/
    cli/
  packages/
    domain/
    scheduler/
    reasoning/
    skills/
    protocol/
  computercraft/
    gateway/
    turtle/
    peripherals/        # Lua wrappers, not Forge code
  forge-addons/         # only if required later
    chat-relay/
    mod-peripherals/
  config/
    agents/
    groups/
    policies/
  deploy/
    vps/
    minecraft/
  tests/
```

## 3. VPS stack

Recommended:

```text
Node.js / TypeScript
Codex CLI
PostgreSQL
systemd
TLS reverse proxy (Caddy or equivalent)
```

The Node.js control plane SHOULD bind only to a non-public listener (loopback or a private
container-network bridge). A TLS reverse proxy is the sole public gateway boundary and SHALL
expose only `/v1/gateway/*` on its dedicated HTTPS port.

## 4. Public gateway endpoint and source allowlist

The current VPS deployment uses this topology. Its final acceptance still requires a live request
from the friend's Minecraft host, because only that request can verify the claimed source address.

The initial source allowlist is:

```text
Minecraft host public IPv4: 51.161.113.44/32
```

The VPS firewall and reverse proxy SHALL both admit HTTPS gateway requests only from this CIDR.
This source restriction is defense in depth; the gateway ID plus bearer secret remain mandatory.
The address MUST be verified from the friend's host before enablement and updated if the host's
egress address changes. An IP allowlist identifies the host/network's public egress address, not
an individual ComputerCraft computer.

The endpoint requires a public DNS hostname and a publicly trusted TLS certificate. The hostname
is intentionally a deployment value, not a repository constant. Use DNS-01 certificate issuance
or another certificate-management method compatible with keeping the gateway route restricted.
HTTP-01 and TLS-ALPN validation normally require temporary public reachability; if used, restrict
that exposure to certificate issuance and remove it before enabling the gateway route.

The public proxy MUST forward only `/v1/gateway/*` to a non-public control-plane listener.
Operator and health interfaces remain local/VPS-only. The current deployment uses
`https://192.99.69.46.sslip.io:8443`, forwarding to a private Docker bridge at
`172.18.0.1:8787`. Docker-published ports bypass ordinary UFW filtering, so this deployment also
requires persistent `DOCKER-USER` firewall rules; see `deploy/vps/Caddyfile.example` and
`deploy/vps/computercraft-agents-docker-firewall.service.example`.

The allowlisted `GET /v1/gateway/connectivity` probe returns HTTP 204 without gateway credentials.
It exists solely to verify the friend's host egress address before the gateway secret is installed;
all other gateway routes retain bearer authentication.

After the public probe succeeds, the authenticated canary is
`GET /v1/gateway/authenticated-connectivity`. It returns HTTP 204 only after validating both
`X-Agent-Gateway-Id` and the gateway bearer secret. This endpoint is diagnostic-only and does not
change gateway or worker state.

The endpoint certificate is configured as RSA-2048 for compatibility with legacy Java 8 runtimes
commonly used with Minecraft 1.7.10 and ComputerCraft 1.75. Do not replace it with a self-signed
certificate; ComputerCraft must be able to validate the public certificate chain.

## 5. ComputerCraft HTTPS

Friend-side setup SHALL verify that the installed ComputerCraft 1.75 HTTP configuration permits
the configured public VPS hostname over HTTPS.

This is a milestone-zero connectivity check, not an assumption.

If HTTPS access is blocked by configuration, update ComputerCraft config/restart as needed. If
version limitations make this impossible, use a small local bridge or revise gateway transport
without changing control-plane domain architecture.

## 6. Gateway installation

Target experience:

1. friend clones repository or downloads release bundle;
2. obtains `computercraft/gateway` files;
3. places them into the selected ComputerCraft computer's filesystem/disk workflow;
4. sets `gateway.conf` values such as VPS URL and server/gateway ID;
5. secret is provided privately and entered locally;
6. starts/reboots gateway computer;
7. sees connection diagnostic.

Because direct filesystem paths for ComputerCraft worlds vary, the repo SHOULD include both:

- a manual in-game paste/disk installation path;
- a host-filesystem copy path for the friend.

## 7. Turtle installation

Each turtle receives:

```text
startup.lua
runtime files
worker config:
  worker_id
  gateway_rednet_id/channel
```

A bootstrap disk/program SHOULD eventually automate this for new turtles.

## 8. Secrets

Never commit:

- gateway bearer secret;
- Codex authentication;
- database password;
- any private endpoint credentials.

Commit templates such as:

```text
.env.example
gateway.conf.example
Caddyfile.example
```

## 9. VPS service lifecycle

Control plane SHALL run under systemd or equivalent and automatically start/restart.

Minecraft restarts do not stop the VPS service.

On gateway disappearance:

```text
gateway OFFLINE
workers OFFLINE
persist jobs
wait
```

On reconnection:

```text
register
compare boot/session IDs
refresh worker observations
reconcile active tasks
resume/replan
```

## 10. Releases

GitHub Actions SHOULD eventually build/test TypeScript and package:

```text
control-plane release artifact
computercraft-lua.zip
optional Forge addon JARs
checksums
release notes
```

The Minecraft friend should not need to compile Java/TypeScript.

## 11. Live-world rollout

Recommended enablement sequence:

```text
read-only gateway
→ movement-only turtle
→ inspect
→ bounded dig/place
→ resource delivery
→ bounded construction
→ multi-worker
→ mod writes
→ DefenseTech destructive capability
```
