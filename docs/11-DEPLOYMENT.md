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
container-network bridge). A TLS reverse proxy is the sole public boundary and SHALL expose only
the authenticated `/v1/gateway/*` and `/v1/worker/*` routes on its dedicated HTTPS port.

## 4. Public gateway endpoint and source allowlist

The current VPS deployment uses this topology. Its final acceptance still requires a live request
from the friend's Minecraft host, because only that request can verify the claimed source address.

The initial source allowlist is:

```text
Minecraft host public IPv4: 51.161.113.44/32
```

The VPS firewall and reverse proxy SHALL both admit HTTPS ComputerCraft requests only from this CIDR.
This source restriction is defense in depth; the gateway ID plus bearer secret remain mandatory.
The address MUST be verified from the friend's host before enablement and updated if the host's
egress address changes. An IP allowlist identifies the host/network's public egress address, not
an individual ComputerCraft computer.

The endpoint requires a public DNS hostname and a publicly trusted TLS certificate. The hostname
is intentionally a deployment value, not a repository constant. Use DNS-01 certificate issuance
or another certificate-management method compatible with keeping the gateway route restricted.
HTTP-01 and TLS-ALPN validation normally require temporary public reachability; if used, restrict
that exposure to certificate issuance and remove it before enabling the gateway route.

The public proxy MUST forward only `/v1/gateway/*` and `/v1/worker/*` to a non-public control-plane
listener. The same source allowlist and TLS certificate apply to both transports.
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

Each gateway-backed turtle receives:

```text
startup.lua
runtime files
worker config:
  worker_id
  gateway_rednet_id/channel
```

A bootstrap disk/program SHOULD eventually automate this for new turtles.

### Direct HTTP turtle installation

A direct worker does not need a modem, gateway computer, `gateway_rednet_id`, or
`rednet_protocol`. Provision it from the operator CLI first:

```bash
npm run cli -- provision-worker \
  --id alice \
  --server friends-server \
  --computer-id 21 \
  --version v0.4.1
```

Copy the turtle runtime and stable bootstrap files from the release archive. Create `worker.conf`
from the example with:

```lua
return {
  worker_id = "alice",
  minecraft_server_id = "friends-server",
  transport = "direct-http",
  vps_url = "https://192.99.69.46.sslip.io:8443",
  vps_bearer_secret = "set-locally",
  runtime_version = "v0.4.1",
  poll_interval_seconds = 2,
  heartbeat_interval_seconds = 10,
}
```

The ComputerCraft HTTP allowlist must permit the VPS hostname over HTTPS. Run `startup`; the
turtle registers, heartbeats, and polls `/v1/worker/commands`. Confirm it with:

```bash
npm run cli -- workers alice
```

Worker inspection includes the current runtime state and, when a task is active, its
`currentTaskId`. The scheduler uses that same value to avoid selecting a worker that is already
executing another task; the database remains the final atomic one-task-per-worker guard.

### Re-anchor a worker after manual relocation

If a turtle is moved manually or its dead-reckoned position is no longer trusted, stand it at a
known coordinate and record that coordinate explicitly. Facing is optional because ComputerCraft
does not expose a universal compass sensor:

```bash
npm run cli -- anchor alice 0 10 64 -2 E
npm run cli -- set-location "Test Chest" 0 10 64 -2 E
npm run cli -- set-location "Test Chest" 0 10 64 -2 E --approach 0 9 64 -2 N
npm run cli -- workers alice
```

The `anchor` command writes a `CONFIRMED_ANCHOR` worker observation. The `set-location` command
records a named destination with the same operator-confirmed coordinates. Add `--approach` with a
safe adjacent turtle standing coordinate when the named block is a container or other interaction
target. These are operator assertions, so only
use coordinates that have been verified in-game; it does not move the turtle or detect direction.

When creating a new `worker.conf`, keep the template's complete `capabilities` list unless a
deliberate canary needs a narrower local allowlist. Older configurations that explicitly list
only movement and inventory skills must add `mining.gather` before a gather preflight can pass.
The turtle startup also logs a warning for each missing first-use capability; it does not enable
the capability automatically.

The turtle's cursor, authenticated UTC clock handoff, and event outbox are local persistent files. Do not commit the populated
configuration or secret.

For a reviewed development build, download `deploy/minecraft/install-direct.lua` from a pinned
40-character Git commit, then run `install-direct <same-commit>`. It downloads and parses all
runtime files before replacing them, and retains root files (including configuration/state)
in a unique `manual-install-backup-*` directory. It also installs the safe
`worker.conf.example` template; copy it to `worker.conf`, configure it locally, and run `startup`.
This manual bootstrap is separate from tagged-release OTA; it does not create a release.

Legacy ComputerCraft 1.75 lacks `os.date`, `os.epoch`, and `textutils.unserializeJSON`.
The turtle bootstrap installs a non-executing JSON decoder and synchronizes UTC from authenticated
VPS response `serverTime` values. Expiry checks fail closed until synchronized; in-game time is
not a UTC clock. `compat.lua` is part of the stable bootstrap and must be installed manually with
`startup.lua`. Run `lua5.1 tests/legacy-runtime.lua` to exercise these legacy compatibility paths.

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

Control-plane process and HTTP logs are newline-delimited JSON. Use the response `X-Request-Id`
when correlating an operator or turtle request with service logs; request bodies and bearer secrets
are intentionally excluded.

The service also performs bounded audit retention cleanup at startup and on a configurable interval.
It removes expired STANDARD/HIGH events and never removes IMMUTABLE events. Review the retention
defaults before production deployment if the server has a different compliance or storage policy.

### Explicit task dispatch

The control plane can atomically dispatch a ready task that already represents one protocol
command. Inspect compatible work, then dispatch it to a specific online worker:

```text
npm run cli -- runnable-tasks
npm run cli -- scheduler-tick
npm run cli -- dispatch-task <task-id> <worker-id>
npm run cli -- task <task-id>
npm run cli -- move <worker-id> <N|E|S|W|UP|DOWN> --dry-run
```

The scheduler tick selects compatible online workers for protocol-level command tasks and then
dispatches them through the same atomic path. Dispatch persists the task claim and command
together, includes the task ID in the command for event correlation, and enforces one active task
per worker. Worker completion/failure/cancellation events update the linked task.
Natural-language `resource.gather` goals remain multi-step workflow records and are not silently
dispatched as a single command. Use `task <task-id>` to inspect one workflow step or parent task,
including its phase, assignment, attempt count, and persisted blocking error.

Before creating the first live gather goal, run the read-only preflight:

```bash
npm run cli -- goal-preflight "@alice get 64 cobblestone and deposit it in Test Chest"
```

Resolve every reported blocker. In particular, the worker must advertise `mining.gather`,
`navigate.path`, and `inventory.deposit`, and its position must be re-anchored after manual
relocation. The preflight cannot inspect the turtle's local `container_sides` table, so verify the
matching physical chest-side mapping in `worker.conf` separately.

The control plane also supports an opt-in bounded background scheduler loop. Set
`SCHEDULER_ENABLED=true` and choose `SCHEDULER_INTERVAL_SECONDS` (10 seconds by default) after
reviewing the task set. Each interval performs at most one non-overlapping scheduler tick; the
loop is disabled by default so deployment does not silently begin dispatching queued work.

The planner loop is separately opt-in. Set `PLANNER_ENABLED=true` only after confirming the VPS
has an authenticated `codex` executable and reviewing the cost, timeout, and retention implications.
Leave `PLANNER_APPLY_ENABLED=false` for plan-only review. The apply gate only accepts validated
`create-task`/`plan` proposals within the existing job and worker scope; all other decision kinds
remain audit-only.

```text
PLANNER_ENABLED=true
PLANNER_APPLY_ENABLED=false
PLANNER_INTERVAL_SECONDS=30
PLANNER_BATCH_SIZE=1
PLANNER_TIMEOUT_MS=30000
PLANNER_MAX_CONCURRENT=1
PLANNER_CLAIM_LEASE_SECONDS=300
PLANNER_FAILURE_THRESHOLD=1
PLANNER_RETRY_AFTER_SECONDS=30
PLANNER_REASONING_TIER=fast
# Optional per-tier Codex CLI overrides. Leave blank to use the CLI default.
PLANNER_FAST_MODEL=
PLANNER_FAST_PROFILE=
PLANNER_STANDARD_MODEL=
PLANNER_STANDARD_PROFILE=
PLANNER_STRONG_MODEL=
PLANNER_STRONG_PROFILE=
CODEX_COMMAND=codex
```

`PLANNER_REASONING_TIER` selects one logical tier. The corresponding optional model/profile
variables are passed only to the Codex CLI invocation for that tier; they do not change the
validated decision schema. Keeping all six override variables blank is valid and uses the locally
configured Codex default.

The loop claims durable planner triggers, invokes Codex in its read-only ephemeral boundary, and
records validated decisions as HIGH-retention audit events. With `PLANNER_APPLY_ENABLED=true`, a
safe subset of validated task proposals becomes ready tasks; the scheduler still controls worker
assignment and command dispatch. Keep the apply gate disabled until the resulting task stream has
been reviewed in a canary environment.

Every stale-worker check is also a recovery boundary. When a worker transitions from online to
stale, the control plane pauses its assigned task, cancels queued or in-flight command delivery,
and queues an independent worker stop control. The task is not automatically retried; after
confirming the turtle is safe, inspect it with `task <task-id>` and explicitly resume it with
`task-status <task-id> READY`.

Physical command, stop-control, update, and addressed gather-goal CLI requests also accept
`--dry-run`. Dry-run builds the same bounded payload locally and prints the intended POST path
without requiring the admin secret or contacting the control plane. For a goal, the preview also
shows the deterministic worker/item/quantity/destination parse, so an operator can catch an
addressing or spelling mistake before creating a persistent goal.

When the scheduler background loop is disabled, `goal ... --start` is the explicit operator path
to create a goal and perform exactly one bounded scheduler tick. It does not bypass capability,
worker-availability, task-dependency, or one-active-task checks. If no worker is eligible, the
response includes a `skipped` entry explaining whether the worker is offline, busy, unknown, or
missing a required capability. Omit `--start` to create the goal without dispatching.

The protected operator inspection commands are:

```bash
npm run cli -- agents
npm run cli -- agent alice
npm run cli -- projects
npm run cli -- feature-gates
npm run cli -- audit 50
npm run cli -- diagnose
```

`diagnose` reports gateway/worker registration and liveness, transports, and observed runtime
versions in one bounded response. It complements the reverse-proxy/firewall source-IP check; the
application cannot independently verify the Minecraft host's public egress address.

Use `pause-task`, `resume-task`, and `cancel-task` for explicit lifecycle control. Pausing or
cancelling a running task cancels its active command delivery, releases the worker claim, and
queues a transport-aware stop control before the task can be resumed or permanently cancelled.

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

Tagged releases are the source for gateway-managed updates. Run `npm run check`, then
`npm run release:lua -- v0.2.0` to inspect the generated archive and `release-manifest.json`.
Pushing a tag matching `v*.*.*` runs the release workflow and publishes both assets. The manifest
contains only managed runtime files and never contains populated configuration, secrets, state,
or outbox files.

After the initial manual installation of the stable bootstrap files, an operator can queue an
update from the VPS:

```text
npm run cli -- update --target worker:alice --version v0.2.0
npm run cli -- update --target fleet:gateway-main --version v0.2.0
npm run cli -- update-status <update-id>
```

The gateway receives the work on its normal authenticated poll, downloads the immutable release
manifest/files over HTTPS, and transfers turtle files over Rednet. Configuration and persistent
state remain local. A turtle must be idle before activation; failures halt the rollout and the
stable bootstrap attempts rollback. See [21-UPDATEABILITY.md](21-UPDATEABILITY.md).

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
