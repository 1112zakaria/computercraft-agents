# ComputerCraft Agents

ComputerCraft-first autonomous Minecraft workers for Minecraft Java 1.7.10 + Forge.

The repository has completed the CC-001 bootstrap, CC-010 protocol-schema, CC-020 database schema,
CC-030–047 ComputerCraft runtime stages, and the first VPS gateway transport/domain slice. It now
supports both gateway-backed Rednet workers and direct HTTP turtles; the control-plane workspace
is intentionally small and dependency-light, while later backlog items add scheduling and
reasoning integrations.

## Quick start

Requirements:

- Node.js 20 or newer;
- npm 10 or newer.

```text
npm ci
npm run check
npm run build
npm test
```

`npm run check` runs lint, formatting verification, TypeScript typechecking, and tests. The
workspace does not require a live Minecraft server, PostgreSQL instance, or Codex credentials for
these baseline checks.

The control plane's Codex planner loop is disabled by default. When explicitly enabled, it is
plan-only unless `PLANNER_APPLY_ENABLED=true` is also set. The apply boundary accepts only
protocol-validated `create-task`/`plan` proposals within the subject job's worker scope, persists
them idempotently, and leaves other decision kinds in audit-only mode. See
[deployment](docs/11-DEPLOYMENT.md) before enabling it.

To package the ComputerCraft programs for friend-side installation, run
`npm run release:lua`. The resulting `dist/release/computercraft-lua.zip` contains no populated
configuration or secrets.

OTA-style updates are queued through the protected VPS CLI and delivered by the gateway poll for
Rednet workers or the direct worker poll for direct turtles:

```text
npm run cli -- update --target worker:alice --version v0.2.0
npm run cli -- update --target fleet:gateway-main --version v0.2.0
npm run cli -- update-status <update-id>
```

Tagged GitHub releases publish the archive and `release-manifest.json`. The update design and
rollback procedure are documented in [Gateway-managed updates](docs/21-UPDATEABILITY.md).

## Worker transports

Gateway-backed workers use:

```text
VPS ⇄ HTTPS ⇄ Gateway ⇄ Rednet ⇄ Turtle
```

Direct workers use:

```text
VPS ⇄ HTTPS ⇄ Turtle
```

Direct setup does not require a gateway computer or wireless modem. Provision one from the
operator CLI, then configure `worker.conf` with `transport = "direct-http"`, the VPS URL, worker
identity, Minecraft server ID, and the existing bearer secret:

```text
  npm run cli -- provision-worker --id alice --server friends-server --computer-id 21 --version v0.4.1
npm run cli -- workers alice
npm run cli -- agents
npm run cli -- agent alice
npm run cli -- projects
npm run cli -- feature-gates
npm run cli -- audit 50
npm run cli -- diagnose
npm run cli -- update --target worker:alice --version v0.4.1
npm run cli -- excavate alice 1 1 8
npm run cli -- path alice N N E
npm run cli -- path-to alice "Test Chest"
npm run cli -- go-to alice "Test Chest"
npm run cli -- set-location "Test Chest" 0 10 64 -2 E --approach 0 9 64 -2 N
npm run cli -- gather alice minecraft:cobblestone 8 12
npm run cli -- deposit alice 8 --container-id test-chest
npm run cli -- withdraw alice minecraft:cobblestone 8 --container-id test-chest
npm run cli -- goal "@alice get 64 cobblestone and deposit it in Test Chest"
npm run cli -- goal-preflight "@alice get 64 cobblestone and deposit it in Test Chest"
npm run cli -- goal "@alice get 64 cobblestone and deposit it in Test Chest" --start
npm run cli -- goal "@alice get 64 cobblestone and deposit it in Test Chest" --dry-run
npm run cli -- locations
npm run cli -- location "Test Chest"
npm run cli -- tasks
npm run cli -- task <task-id>
npm run cli -- goal-report <task-id>
npm run cli -- planner-triggers [limit]
npm run cli -- planner-status
npm run cli -- planning-context <task-id>
npm run cli -- runnable-tasks
npm run cli -- dispatch-task <task-id> <worker-id>
npm run cli -- scheduler-tick
npm run cli -- task-status <task-id> BLOCKED
npm run cli -- pause-task <task-id> "operator review"
npm run cli -- resume-task <task-id>
npm run cli -- cancel-task <task-id> "operator cancelled"
npm run cli -- move alice N --dry-run
npm run cli -- set-location "Test Chest" 0 10 64 -2 E
```

See [architecture](docs/02-ARCHITECTURE.md), [protocol](docs/05-PROTOCOL.md), and
[Minecraft-side deployment](deploy/minecraft/README.md) for endpoint and installation details.
The gateway route remains available for modem-equipped fleets.

Run `goal-preflight` before creating the first useful gather goal. It is read-only and reports
worker capability, online/idle state, confirmed position, named destination, and known-route
blockers. It cannot verify the physical chest side inside `worker.conf`; that remains an operator
advisory.

## Repository layout

```text
apps/                 Runnable control-plane and CLI entry points
packages/             Shared domain, protocol, scheduler, reasoning, and skill packages
computercraft/        Gateway and turtle Lua runtime homes
config/               Safe, non-secret agent/group/policy templates
deploy/               VPS and Minecraft installation templates
forge-addons/         Optional narrow Forge integrations, if later required
tests/                Cross-package and workspace-level tests
docs/                 Requirements, architecture, contracts, backlog, and operations
```

## Documentation

- [Specification overview](docs/00-README.md)
- [Architecture](docs/02-ARCHITECTURE.md)
- [Deployment](docs/11-DEPLOYMENT.md)
- [Connectivity sequence](docs/20-CONNECTIVITY-SEQUENCE.md)
- [Safety and operations](docs/12-SAFETY-OPERATIONS.md)
- [Testing strategy](docs/13-TESTING.md)
- [Roadmap](docs/15-ROADMAP.md)
- [Architecture decisions](docs/16-ARCHITECTURE-DECISIONS.md)
- [Open questions](docs/17-OPEN-QUESTIONS.md)
- [Implementation backlog](docs/18-CODEX-BACKLOG.md)
- [Implementation checklist](docs/19-IMPLEMENTATION-CHECKLIST.md)
- [Coding-agent instructions](docs/AGENTS.md)

For a manually verified turtle position, record an operator anchor before planning a route:

```bash
npm run cli -- anchor alice 0 10 64 -2 E
```

## Safety

Never commit `.env`, gateway bearer secrets, database passwords, TLS private keys, or
credentials. The first live-world rollout must remain read-only/movement-only and bounded as
described in the deployment and safety specifications.
