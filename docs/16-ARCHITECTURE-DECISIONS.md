# Architecture Decisions

## ADR-001 — Use ComputerCraft turtles as the first worker body

**Decision:** Accepted.

**Reason:** The actual requirement is an in-world entity that executes natural-language goals, not a realistic player. Turtles already provide deterministic movement, digging, placement, inventory handling, crafting, inspection, and basic attack primitives and are already installed in the modpack.

**Consequence:** Remove humanoid/player survival simulation from the critical path.

## ADR-002 — Keep the distributed VPS control plane

**Decision:** Accepted.

Reasoning, persistent state, scheduling, memory, and project planning remain outside the legacy Minecraft JVM and ComputerCraft runtime.

## ADR-003 — Gateway computer between VPS and turtles

**Decision:** Preferred v1 topology.

One gateway reduces HTTP/network configuration and centralizes Rednet routing, buffering, authentication, and diagnostics.

## ADR-004 — HTTP/JSON over WireGuard for VPS↔gateway

**Decision:** Accepted as baseline subject to a milestone-zero ComputerCraft 1.75 connectivity verification.

WireGuard supplies private network reachability; HTTP is simple for ComputerCraft and the modern VPS service.

## ADR-005 — Rednet/modem for gateway↔worker transport

**Decision:** Accepted.

Workers remain lightweight and local to the Minecraft world.

## ADR-006 — TypeScript/Node on VPS

**Decision:** Preferred.

It is well-suited to async orchestration and aligns with the intended Codex CLI/SDK ecosystem. Performance requirements at 3–5 workers do not justify a lower-level runtime.

## ADR-007 — PostgreSQL for durable control-plane state

**Decision:** Accepted default.

Projects, jobs, conversations, memory metadata, world knowledge, and audit are relational/structured and benefit from durable transactions.

## ADR-008 — Codex CLI behind `ReasoningProvider`

**Decision:** Accepted.

The architecture remains provider-neutral even though v1 only intends to use Codex.

## ADR-009 — Event-driven LLM calls

**Decision:** Accepted.

Codex reasons on material events, not movement/game ticks. Deterministic code handles execution.

## ADR-010 — Central scheduler owns task assignment

**Decision:** Accepted.

Agents can request delegation but cannot directly mutate peer queues.

## ADR-011 — One physical action stream per turtle

**Decision:** Accepted.

A logical agent may have multiple jobs, but physical execution remains serialized per worker.

## ADR-012 — Prefer existing peripherals before custom Forge code

**Decision:** Accepted.

Use OpenPeripheral/ComputerCraft capabilities first. Build narrow peripheral adapters only for missing functions such as selected Mekanism/DefenseTech APIs.

## ADR-013 — Do not implement player survival semantics

**Decision:** Accepted.

Health, hunger, armor, XP, sleep, player list, and humanoid rendering are explicitly outside core scope.

## ADR-014 — Live-world safety via gates/budgets, not rollback

**Decision:** Accepted.

Development happens on the live world. The project implements stop, budgets, dry-run, canaries, and audit, but not automated world rollback.

## ADR-015 — Keep worker backend pluggable

**Decision:** Accepted.

ComputerCraft is first, not permanently exclusive. A future CustomNPC+ backend can be added if tasks arise that turtles fundamentally handle poorly.
