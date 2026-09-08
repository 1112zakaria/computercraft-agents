# ComputerCraft Agents

ComputerCraft-first autonomous Minecraft workers for Minecraft Java 1.7.10 + Forge.

The repository has completed the CC-001 bootstrap, CC-010 protocol-schema, CC-020 database schema,
CC-030–047 ComputerCraft runtime stages, and the first VPS gateway transport/domain slice. The
control-plane workspace is intentionally small and dependency-light; later backlog items add
scheduling and reasoning
integrations.

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

To package the ComputerCraft programs for friend-side installation, run
`npm run release:lua`. The resulting `dist/release/computercraft-lua.zip` contains no populated
configuration or secrets.

Gateway-managed OTA-style updates are queued through the protected VPS CLI and delivered by the
gateway's existing HTTPS poll:

```text
npm run cli -- update --target worker:alice --version v0.2.0
npm run cli -- update --target fleet:gateway-main --version v0.2.0
npm run cli -- update-status <update-id>
```

Tagged GitHub releases publish the archive and `release-manifest.json`. The update design and
rollback procedure are documented in [Gateway-managed updates](docs/21-UPDATEABILITY.md).

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

## Safety

Never commit `.env`, gateway bearer secrets, database passwords, TLS private keys, or
credentials. The first live-world rollout must remain read-only/movement-only and bounded as
described in the deployment and safety specifications.
