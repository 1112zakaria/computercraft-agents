# Implementation Checklist

## A. Milestone-zero feasibility

Direct HTTP canary status (the modem-less primary path):

- [x] Direct turtle registration and heartbeat visible from the CLI.
- [x] Direct bounded movement command and event submission validated on `alice`.
- [x] Direct runtime OTA activation/reboot validated on `alice`.
- [ ] Post-reboot automatic CraftOS startup-hook behavior validated live (tracked in issue #7).

- [ ] Exact Java/Forge builds recorded.
- [x] Public DNS hostname and trusted TLS certificate verified for the gateway endpoint.
- [x] VPS firewall and reverse-proxy allowlist admit only `51.161.113.44/32`.
- [x] ComputerCraft gateway can HTTPS-connect to the public VPS endpoint.
- [x] Gateway authentication works.
- [ ] One turtle registers over Rednet.
- [ ] Worker heartbeat/state visible from CLI.
- [ ] One bounded movement command works end-to-end.
- [ ] `stop alice` works without Codex.
- [ ] Events persist in PostgreSQL.

## B. Turtle runtime

- [ ] Stable worker IDs.
- [ ] Boot/session IDs.
- [x] Position/orientation persistence.
- [x] Position confidence states.
- [ ] Inspect/move/dig/place normalized results.
- [ ] Inventory snapshot.
- [ ] Fuel handling.
- [x] Cancellation checks.
- [x] Primitive/block budgets.
- [x] Command idempotency.
- [x] Bounded event/outbox storage.

## C. Navigation

- [ ] Sparse world model.
- [x] A* known-map pathfinding.
- [x] Path executor.
- [ ] Blocked-path replan.
- [x] Position anchoring/recalibration.
- [x] Named location/dock model.
- [ ] Exploration strategy.
- [ ] Worker-area reservations.

## D. Control plane

- [ ] Agent/group registry.
- [ ] Worker binding.
- [ ] Projects/jobs/tasks/dependencies.
- [ ] Central scheduler.
- [ ] One execution stream invariant.
- [x] Stop/pause/resume/cancel.
- [ ] Delegation requests.
- [ ] Resource reservations.
- [ ] Standing policies.
- [ ] Conversations.
- [ ] World knowledge.
- [ ] Audit lineage.

## E. Reasoning

- [x] `ReasoningProvider` interface.
- [x] Fake provider for CI.
- [x] Codex CLI provider.
- [x] Structured decisions.
- [x] Concurrent request limiter.
- [x] Event-driven triggers.
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

- [x] Feature gates.
- [x] Global stop.
- [x] Per-worker stop.
- [x] Plan-only mode.
- [ ] Live-world action budgets.
- [x] Structured logs.
- [x] Retention cleanup.
- [ ] Control-plane systemd service.
- [x] ComputerCraft release bundle.
- [x] Friend-side installation guide.
- [x] Automatic reconnect/reconcile after server restart.
- [ ] No-human-online/chunk behavior validated.
