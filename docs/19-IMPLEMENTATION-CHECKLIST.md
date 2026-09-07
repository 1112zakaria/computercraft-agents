# Implementation Checklist

## A. Milestone-zero feasibility

- [ ] Exact Java/Forge builds recorded.
- [ ] WireGuard peer connectivity verified.
- [ ] ComputerCraft gateway can HTTP-connect to VPS private endpoint.
- [ ] Gateway authentication works.
- [ ] One turtle registers over Rednet.
- [ ] Worker heartbeat/state visible from CLI.
- [ ] One bounded movement command works end-to-end.
- [ ] `stop alice` works without Codex.
- [ ] Events persist in PostgreSQL.

## B. Turtle runtime

- [ ] Stable worker IDs.
- [ ] Boot/session IDs.
- [ ] Position/orientation persistence.
- [ ] Position confidence states.
- [ ] Inspect/move/dig/place normalized results.
- [ ] Inventory snapshot.
- [ ] Fuel handling.
- [ ] Cancellation checks.
- [ ] Primitive/block budgets.
- [ ] Command idempotency.
- [ ] Bounded event/outbox storage.

## C. Navigation

- [ ] Sparse world model.
- [ ] A* known-map pathfinding.
- [ ] Path executor.
- [ ] Blocked-path replan.
- [ ] Position anchoring/recalibration.
- [ ] Named location/dock model.
- [ ] Exploration strategy.
- [ ] Worker-area reservations.

## D. Control plane

- [ ] Agent/group registry.
- [ ] Worker binding.
- [ ] Projects/jobs/tasks/dependencies.
- [ ] Central scheduler.
- [ ] One execution stream invariant.
- [ ] Stop/pause/resume/cancel.
- [ ] Delegation requests.
- [ ] Resource reservations.
- [ ] Standing policies.
- [ ] Conversations.
- [ ] World knowledge.
- [ ] Audit lineage.

## E. Reasoning

- [ ] `ReasoningProvider` interface.
- [ ] Fake provider for CI.
- [ ] Codex CLI provider.
- [ ] Structured decisions.
- [ ] Fast/standard/strong tier config.
- [ ] Concurrent request limiter.
- [ ] Event-driven triggers.
- [ ] Individual planners.
- [ ] Shared project planner heuristic.
- [ ] Refusal/override.
- [ ] LLM outage pause/recovery.

## F. Interaction

- [ ] Explicit `@agent` parsing.
- [ ] `@group`.
- [ ] `@all`.
- [ ] Multiple named recipients.
- [ ] Unaddressed-context rule.
- [ ] CLI natural-language surface.
- [ ] Conversation persistence.
- [ ] Minecraft chat relay/peripheral.
- [ ] Owner authorization.
- [ ] In-game replies/status.
- [ ] Player position/context for `here` where available.

## G. First useful worker

- [ ] Bounded excavation.
- [ ] Gather resource.
- [ ] Inventory full handling.
- [ ] Deposit to known chest.
- [ ] Delivery verification.
- [ ] `@alice get 64 cobblestone and deposit it in Test Chest` passes.

## H. Multi-agent

- [ ] 3–5 turtles registered.
- [ ] Scheduler parallelism.
- [ ] Groups have persistent purpose.
- [ ] Delegation.
- [ ] Resource conflict prevention.
- [ ] Worker disappearance/reassignment.
- [ ] Agent-agent visible coordination.
- [ ] Restart recovery.

## I. Construction

- [ ] Blueprint schema.
- [ ] Material bill.
- [ ] Design validation/bounds.
- [ ] Placement executor.
- [ ] Desired-state verification.
- [ ] Material acquisition linkage.
- [ ] Multi-worker partitioning.
- [ ] Human acceptance state.

## J. Mods

### AE2

- [ ] Actual peripheral methods inventoried.
- [ ] Storage read.
- [ ] Deposit/withdraw.
- [ ] Resource planner integration.
- [ ] Autocrafting feasibility assessed.

### Mekanism

- [ ] Existing peripheral support assessed.
- [ ] Minimal adapter contract if needed.
- [ ] Read-only inspection.
- [ ] Selected config writes.
- [ ] One processing chain verified end-to-end.

### DefenseTech

- [ ] API/peripheral research.
- [ ] Manufacture/place.
- [ ] Configure/arm.
- [ ] Fire/use.
- [ ] Capability gate.
- [ ] High-retention audit.
- [ ] Canary acceptance.

### Thaumcraft

- [ ] Existing OpenPeripheral functions inventoried.
- [ ] Turtle-accessible automation separated from player-bound progression.
- [ ] Unsupported player progression explicitly documented if applicable.

## K. Operations

- [ ] Feature gates.
- [ ] Global stop.
- [ ] Per-worker stop.
- [ ] Plan-only mode.
- [ ] Live-world action budgets.
- [ ] Structured logs.
- [ ] Retention cleanup.
- [ ] Control-plane systemd service.
- [ ] ComputerCraft release bundle.
- [ ] Friend-side installation guide.
- [ ] Automatic reconnect/reconcile after server restart.
- [ ] No-human-online/chunk behavior validated.
