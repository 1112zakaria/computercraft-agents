# ComputerCraft Agents

ComputerCraft-first autonomous Minecraft workers for Minecraft Java 1.7.10 + Forge.

The repository has completed the CC-001 bootstrap and CC-010 protocol-schema stages. The
control-plane workspace is intentionally small and dependency-light; later backlog items add
persistence, gateway transport, turtle execution, scheduling, and reasoning integrations.

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
- [Safety and operations](docs/12-SAFETY-OPERATIONS.md)
- [Testing strategy](docs/13-TESTING.md)
- [Roadmap](docs/15-ROADMAP.md)
- [Architecture decisions](docs/16-ARCHITECTURE-DECISIONS.md)
- [Open questions](docs/17-OPEN-QUESTIONS.md)
- [Implementation backlog](docs/18-CODEX-BACKLOG.md)
- [Implementation checklist](docs/19-IMPLEMENTATION-CHECKLIST.md)
- [Coding-agent instructions](docs/AGENTS.md)

## Safety

Never commit `.env`, gateway bearer secrets, database passwords, WireGuard private keys, or
credentials. The first live-world rollout must remain read-only/movement-only and bounded as
described in the deployment and safety specifications.
