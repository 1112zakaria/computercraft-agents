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

The Node.js control plane SHOULD bind only to loopback. A TLS reverse proxy is the sole public
gateway boundary and SHALL expose only `/v1/gateway/*` on HTTPS port 443.

## 4. Public gateway endpoint and source allowlist

This is the target topology specified by this branch. It does not by itself change the currently
running VPS service; the public-ingress work item in `18-CODEX-BACKLOG.md` must be completed and
verified before the WireGuard-only deployment is retired.

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

The public proxy MUST forward only `/v1/gateway/*` to `127.0.0.1:8787`. Operator and health
interfaces remain local/VPS-only. See `deploy/vps/Caddyfile.example` for a non-secret template.

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
