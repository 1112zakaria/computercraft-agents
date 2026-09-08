# Testing Strategy

## 1. Constraint

Testing will occur against the live server/world, so automated logic MUST have strong unit/simulation coverage before mutation is enabled in-world.

## 2. Test pyramid

### Unit tests — control plane

Test:

- address parsing;
- authorization;
- scheduler priorities;
- task dependencies;
- stop/cancel transitions;
- resource reservations;
- context assembly;
- reasoning output validation;
- project-planner escalation;
- protocol schema validation;
- event deduplication;
- outage transitions.

### Unit tests — Lua

Use a Lua test harness or mocked ComputerCraft APIs to test:

- movement state updates;
- turn/orientation math;
- inventory slot logic;
- budgets;
- cancellation;
- command idempotency cache;
- Rednet serialization;
- gateway outbox retry;
- skill state machines.

### Simulation tests

Provide a fake turtle/world adapter in TypeScript or Lua capable of deterministic cells/inventory/fuel. Use it to test pathfinding and build/mining algorithms without Minecraft.

### Integration tests

Test:

- gateway HTTP registration against local control plane;
- command polling;
- event ingestion;
- gateway↔fake turtle Rednet protocol;
- gateway-managed update controls and fake Rednet file/chunk transfer;
- duplicate/out-of-order chunks, stale boot IDs, unsafe paths, interruption, and rollback;
- PostgreSQL persistence;
- Codex adapter with mocked/fixed outputs by default.

### Live canary tests

Small bounded experiments on the real server.

## 3. Milestone-zero live acceptance

1. Gateway can reach the public VPS HTTPS endpoint from the allowlisted Minecraft-host address.
2. VPS sees gateway heartbeat.
3. One turtle registers through Rednet.
4. CLI can request turtle state.
5. CLI issues one `turn` or `forward` command.
6. Turtle result arrives and is persisted.
7. `stop alice` is effective without Codex.

## Gateway-managed update acceptance

Before a live canary, the fake integration must prove:

1. CLI update request persists once and is idempotent on retry;
2. gateway poll delivers the update control;
3. an idle fake turtle stages and activates the allowlisted files;
4. duplicate/out-of-order chunks do not corrupt the assembled file;
5. a failed activation restores the previous runtime;
6. configuration, state, command cache, logs, and outbox files remain untouched.

## 4. First useful-agent acceptance

Natural language:

```text
@alice get 64 cobblestone and deposit it in the test chest
```

Acceptance:

- command is parsed/addressed;
- planner emits structured goal/task plan;
- scheduler assigns Alice;
- Alice moves/mines with bounded logic;
- inventory fullness is handled;
- Alice reaches deposit location;
- 64 cobblestone are verified delivered;
- project is marked complete;
- user receives completion report;
- action lineage is inspectable.

## 5. Construction acceptance

Goal:

```text
@alice build a 5x5 stone hut at Test Build Site
```

Acceptance:

- blueprint generated;
- material bill generated;
- missing material work created;
- block placement stays inside defined bounds;
- already-correct cells are skipped;
- final blueprint verification passes for observable cells;
- task reaches awaiting-acceptance/completed state.

## 6. Multi-agent acceptance

Goal requiring at least two workers.

Acceptance:

- shared planner/scheduler creates parallel work;
- no worker has two simultaneous action streams;
- assignments persist across control-plane restart;
- resource reservations prevent obvious double allocation;
- worker failure permits reassign/replan;
- visible coordination is recorded.

## 7. Mod adapter acceptance

Every mod integration requires:

- read-only discovery test;
- bounded mutation test;
- postcondition verification;
- capability gate test;
- audit event test;
- failure behavior test.

## 8. Codex tests

Do not make normal CI depend on live Codex availability.

Implement:

- fake `ReasoningProvider` fixtures;
- schema-validation tests;
- recorded decision fixtures;
- optional manual/live Codex integration test suite.
