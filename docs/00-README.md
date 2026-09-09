# Minecraft Autonomous Agents — ComputerCraft Implementation Specification

Status: **Requirements baseline / implementation-ready after initial connectivity spike**  
Target game: **Minecraft Java 1.7.10 + Forge**  
Primary execution backend: **ComputerCraft 1.75 turtles and computers**  
Control plane: **VPS-hosted**  
Reasoning backend: **Codex CLI behind a provider-neutral interface**  
Initial scale: **3–5 logical worker agents**  
Network: **outbound HTTPS from gateways or turtles to a public VPS endpoint, restricted by source-IP allowlist**

## Purpose

This pack specifies a reduced-development implementation of the autonomous Minecraft worker system. The product goal is no longer to emulate full human players. The goal is to provide persistent in-world workers that accept natural-language goals and autonomously perform useful Minecraft work.

The first execution backend is ComputerCraft because the target modpack already contains ComputerCraft 1.75, Computronics, OpenPeripheralCore, OpenPeripheralIntegration, and OpenPeripheralAddons. Turtles provide deterministic movement, digging, placement, inventory transfer, inspection, crafting, and basic attack primitives without requiring a custom humanoid/player runtime.

The system remains distributed: the VPS owns reasoning, scheduling, persistent state, memory, projects, policies, and user interaction. Minecraft-side Lua programs provide deterministic execution and observation.

## Non-goals

The following are explicitly not core requirements:

- humanoid workers;
- vanilla-player health, hunger, armor, XP, sleep, death, or respawn semantics;
- appearing in the tab/player list;
- exact `EntityPlayerMP` behavior;
- building a general-purpose autonomous player engine;
- project-level world rollback.

## Architecture at a glance

```text
                           VPS CONTROL PLANE

  Minecraft chat/CLI ──► Command Router ──► Scheduler / Projects
                                                │
                             ┌──────────────────┼──────────────────┐
                             ▼                  ▼                  ▼
                        Alice Planner       Bob Planner      Project Planner
                             │                  │                  │
                             └──────────────────┼──────────────────┘
                                                ▼
                                          Skill Executor
                                                │
                                         HTTP/JSON API
                                                │
════════════ HTTPS ingress (source allowlisted) ═╪══════════════════════════
                                                │
                         ┌──────────────────────┴──────────────────────┐
                         ▼                                             ▼
                ComputerCraft Gateway                         Direct HTTP Turtle
                         │                                             │
                     Rednet/modem                                     │
                 ┌───────┼────────┐                                   │
                 ▼       ▼        ▼                                   │
             Alice Turtle Bob Turtle Charlie Turtle                    │
                 │       │        │                                   │
                 └───────┴────────┴───────────────────────────────────┘
                                                ▼
                                       Minecraft + modpack
```

Two worker transports are supported. `gateway-rednet` uses one ComputerCraft gateway to
communicate with the VPS and Rednet/modems to communicate with turtles. `direct-http` has each
turtle poll the same HTTPS control plane directly and does not require a modem. The gateway
topology remains preferred for fleets because it centralizes local routing and buffering; direct
HTTP is the primary low-hardware path for a single turtle.

## Document map

- [01-REQUIREMENTS.md](01-REQUIREMENTS.md) — normative product and system requirements.
- [02-ARCHITECTURE.md](02-ARCHITECTURE.md) — distributed architecture and component boundaries.
- [03-COMPUTERCRAFT-EXECUTION.md](03-COMPUTERCRAFT-EXECUTION.md) — gateway and turtle runtime design.
- [04-AGENT-SCHEDULER.md](04-AGENT-SCHEDULER.md) — logical agents, jobs, projects, groups, delegation, priorities.
- [05-PROTOCOL.md](05-PROTOCOL.md) — VPS↔gateway and gateway↔turtle message contracts.
- [06-DATA-MODEL.md](06-DATA-MODEL.md) — PostgreSQL and Minecraft-side state ownership.
- [07-SKILLS.md](07-SKILLS.md) — deterministic skill hierarchy and planner tool surface.
- [08-NAVIGATION-WORLD-MODEL.md](08-NAVIGATION-WORLD-MODEL.md) — mapping, coordinates, routing, exploration, named locations.
- [09-MOD-INTEGRATION.md](09-MOD-INTEGRATION.md) — AE2/OpenPeripheral and future mod integration strategy.
- [10-INTERACTION.md](10-INTERACTION.md) — Minecraft chat, CLI, addressing, conversation and deictic references.
- [11-DEPLOYMENT.md](11-DEPLOYMENT.md) — Git, public HTTPS ingress, VPS, Lua deployment, friend-side setup.
- [12-SAFETY-OPERATIONS.md](12-SAFETY-OPERATIONS.md) — live-world safeguards, stop/cancel, outage behavior.
- [13-TESTING.md](13-TESTING.md) — test pyramid and live-world canary acceptance tests.
- [14-OBSERVABILITY.md](14-OBSERVABILITY.md) — logs, conversations, action lineage, retention.
- [15-ROADMAP.md](15-ROADMAP.md) — implementation milestones.
- [16-ARCHITECTURE-DECISIONS.md](16-ARCHITECTURE-DECISIONS.md) — settled decisions and rationale.
- [17-OPEN-QUESTIONS.md](17-OPEN-QUESTIONS.md) — technical unknowns to resolve by spikes.
- [18-CODEX-BACKLOG.md](18-CODEX-BACKLOG.md) — ordered coding backlog for Codex.
- [19-IMPLEMENTATION-CHECKLIST.md](19-IMPLEMENTATION-CHECKLIST.md) — release-readiness checklist.
- [20-CONNECTIVITY-SEQUENCE.md](20-CONNECTIVITY-SEQUENCE.md) — gateway/VPS/turtle message flow.
- [21-UPDATEABILITY.md](21-UPDATEABILITY.md) — gateway-managed OTA-style runtime updates.
- [22-CHUNK-LOADING.md](22-CHUNK-LOADING.md) — offline operation, chunk loading, and bounded validation.
- [AGENTS.md](AGENTS.md) — repository instructions for Codex/coding agents.

## Normative language

- **SHALL / MUST** — required.
- **SHOULD** — strong preference unless implementation evidence justifies deviation.
- **MAY** — optional or future functionality.

## Primary implementation principle

**The LLM chooses goals and plans; deterministic code performs Minecraft actions.**

Codex SHALL NOT be placed in a game-tick loop. It SHOULD reason when a goal arrives, a meaningful step completes, delegation is needed, the world contradicts the plan, an operation fails materially, or replanning is required.
