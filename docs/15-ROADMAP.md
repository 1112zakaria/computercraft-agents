# Implementation Roadmap

## Milestone 0 — Connectivity and one deterministic turtle

Goal: prove ComputerCraft can serve as the execution backend before building substantial agent logic.

Deliver:

- repository/bootstrap;
- VPS HTTP gateway API;
- WireGuard/private endpoint config;
- ComputerCraft gateway Lua program;
- one turtle runtime;
- Rednet registration;
- worker heartbeat/state;
- one bounded movement command;
- stop command;
- event persistence.

Exit criterion:

`CLI → VPS → gateway → Alice turtle → result → VPS` works reliably.

## Milestone 1 — Turtle execution foundation

Deliver:

- position/orientation tracking;
- inspect/move/dig/place primitives;
- inventory snapshot;
- fuel handling;
- command idempotency;
- cancellation/budgets;
- deterministic navigation to known coordinates;
- fake-world simulation tests.

## Milestone 2 — Control plane domain model

Deliver:

- PostgreSQL schema/migrations;
- agent/worker/group registries;
- projects/jobs/tasks;
- scheduler;
- priorities;
- pause/resume/cancel;
- standing-policy skeleton;
- conversation/audit persistence;
- named locations.

## Milestone 3 — Codex reasoning

Deliver:

- provider-neutral interface;
- Codex CLI adapter;
- structured output schemas;
- fast/standard/strong reasoning tiers;
- concurrency limit;
- event-driven planner invocation;
- individual planners;
- automatic shared project planner escalation;
- outage behavior.

Exit demo:

```text
@alice turn around / go to known point
```

is interpreted through natural language and executed without direct primitive instructions from the user.

## Milestone 4 — First useful worker

Deliver:

- resource gathering skill;
- inventory-full handling;
- known chest/destination logistics;
- bounded exploration/mining;
- delivery verification;
- first end-to-end resource goal.

Exit demo:

```text
@alice get 64 cobblestone and put it in Test Chest
```

## Milestone 5 — Multi-agent scheduling

Deliver:

- 3–5 workers;
- persistent groups/purposes;
- task dependencies;
- scheduler-mediated delegation;
- resource reservations;
- visible coordination messages;
- worker disappearance/reassignment;
- restart reconciliation.

## Milestone 6 — Building

Deliver:

- blueprint representation;
- natural-language design to blueprint;
- material bill;
- material acquisition tasks;
- bounded placement engine;
- worker partitioning/reservations;
- desired-state verification;
- human acceptance state.

## Milestone 7 — Minecraft chat integration

Deliver the lowest-cost compatible path:

- chat-box peripheral OR small Forge chat relay;
- user identity/authorization;
- player position/context where possible;
- in-game agent replies/status.

This milestone MAY move earlier if a compatible chat peripheral already works with the pack.

## Milestone 8 — AE2/OpenPeripheral

Deliver:

- peripheral discovery tooling;
- inspect method lists/types;
- read ME storage;
- deposit/withdraw if supported;
- scheduler resource integration;
- autocrafting feasibility.

## Milestone 9 — Mekanism

Deliver:

- generic physical interactions first;
- exact API/peripheral research;
- minimal peripheral adapter if needed;
- inspect/configure selected machines;
- end-to-end automation verification.

## Milestone 10 — DefenseTech

Deliver:

- manufacture/place/configure;
- arm/fire adapter as needed;
- feature gates;
- audit;
- bounded canary validation.

## Milestone 11 — Thaumcraft and broader mod support

Separate:

- turtle-accessible machine/world automation;
- player-bound progression that may remain unsupported.

Then prioritize additional OpenPeripheral-supported mods based on actual use.

## Later

- CustomNPC+ backend if turtle limitations become material;
- richer transport adapters;
- cross-dimensional automation;
- web dashboard/map;
- multi-user ownership/permissions;
- additional peripheral bridge mods.
