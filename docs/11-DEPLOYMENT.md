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
WireGuard
systemd
```

The control plane SHOULD expose its ComputerCraft gateway endpoint only on the WireGuard/private interface when practical.

## 4. WireGuard

Example private topology:

```text
VPS:              10.50.0.1
Minecraft host:   10.50.0.2
```

The application SHALL treat WireGuard as infrastructure. URLs/ports remain configurable.

## 5. ComputerCraft HTTP

Friend-side setup SHALL verify that the installed ComputerCraft 1.75 HTTP configuration permits the VPS WireGuard address/port.

This is a milestone-zero connectivity check, not an assumption.

If private-IP access is blocked by configuration, update ComputerCraft config/restart as needed. If version limitations make this impossible, use a small local bridge or revise gateway transport without changing control-plane domain architecture.

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
- WireGuard private keys;
- any private endpoint credentials.

Commit templates such as:

```text
.env.example
gateway.conf.example
wireguard-example.conf
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
