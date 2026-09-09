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
- planner decision validation and fake reasoning responses;
- planner trigger classification, bounded provider invocation, and duplicate-trigger suppression;
- opt-in planner runner claim/release behavior, high-retention decision recording, and safe
  task-proposal application/idempotency when explicitly enabled;
- reasoning outage pause, bounded retry, and recovery reset;
- bounded gather workflow transitions and terminal blocking;
- blocked navigation contradiction handling and the maximum-three-attempt gather replan boundary;
- reasoning output validation;
- project-planner escalation;
- addressed gather-goal dry-run validation and explicit one-tick goal start behavior;
- protocol schema validation;
- event deduplication;
- stale-worker recovery pauses and cancels work before explicit resume;
- stale-worker reconciliation writes a high-retention recovery audit record;
- structured request logs carry correlation IDs and redact secret-like fields;
- protected audit inspection returns bounded recovery/event history;
- retention cleanup deletes only expired STANDARD/HIGH audit events and preserves IMMUTABLE history;
- gateway restart recovery cancels uncertain delivery, pauses assigned work, and queues stops;
- turtle boot changes cancel uncertain delivery for both direct and gateway transports;
- control-plane startup invalidates online work before reconnect and explicit resume;
- scheduler selection skips workers whose worker inspection reports an active task;
- operator pause/cancel stops active delivery atomically and resume returns work to `READY`;
- agent and project inspection API/CLI responses;
- environment-backed feature-gate inspection and disabled-skill rejection;
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
- direct worker registration, bounded command polling, cursor persistence, and event outbox retry;
- direct worker identity/authentication mismatch and stale boot rejection;
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

## Direct HTTP worker acceptance

The fake transport must prove the no-modem path independently of Rednet:

1. provision a `direct-http` worker and register it with the worker header and payload identity;
2. reject a header/payload identity mismatch;
3. persist a heartbeat and expose `transport: direct-http` through worker inspection;
4. deliver one bounded movement command and an urgent stop control through `/v1/worker/commands`;
5. accept a duplicate event batch without duplicating the event;
6. preserve the poll cursor and retry the durable event outbox after a simulated HTTP failure;
7. deliver an individual update control, then prove activation and rollback leave `worker.conf`
   and worker state untouched.

Live direct canary:

```text
direct turtle startup
→ HTTPS registration
→ heartbeat visible on VPS
→ CLI movement command
→ bounded turtle poll/execution
→ direct event submission
→ CLI worker inspection
→ explicit runtime update
→ reboot and new-version heartbeat
```

This canary requires only ComputerCraft HTTP access and the VPS allowlist; it does not require a
gateway computer or wireless modem.

The operator position-anchor path is also covered: a protected request stores explicit coordinates
as `CONFIRMED_ANCHOR` and may include a manually verified facing. It never infers compass
orientation from the turtle runtime.

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
- an inventory-full command attempts a bounded return-to-container/deposit/resume loop and falls
  back to an explicit pause when the position or route evidence is insufficient;
- Alice reaches deposit location;
- a blocked route records the contradicted cell and deterministically replans when a known alternate
  route exists, without retrying indefinitely;
- 64 cobblestone have a verified moved quantity and post-transfer inventory evidence;
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
- injected-executor tests for the read-only Codex CLI boundary, including timeout/cancellation and
  sanitized process handling;
- optional manual/live Codex integration test suite.
