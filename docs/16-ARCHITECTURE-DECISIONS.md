# Architecture Decisions

## ADR-001 — Use ComputerCraft turtles as the first worker body

**Decision:** Accepted.

**Reason:** The actual requirement is an in-world entity that executes natural-language goals, not a realistic player. Turtles already provide deterministic movement, digging, placement, inventory handling, crafting, inspection, and basic attack primitives and are already installed in the modpack.

**Consequence:** Remove humanoid/player survival simulation from the critical path.

## ADR-002 — Keep the distributed VPS control plane

**Decision:** Accepted.

Reasoning, persistent state, scheduling, memory, and project planning remain outside the legacy Minecraft JVM and ComputerCraft runtime.

## ADR-003 — Support gateway-rednet and direct-http worker transports

**Decision:** Accepted dual transport model. `gateway-rednet` remains the preferred topology for
fleets; `direct-http` is a first-class option for a single turtle or installations where modem
hardware is unavailable.

The gateway transport is:

```text
VPS ⇄ HTTPS ⇄ Gateway ⇄ Rednet ⇄ Turtle
```

The direct transport is:

```text
VPS ⇄ HTTPS ⇄ Turtle
```

Direct workers have no gateway association. Both transports use the same deterministic turtle
executor, control-plane command model, stop path, telemetry, and OTA/update lifecycle.

**Rationale:** One gateway reduces HTTP/network configuration and centralizes Rednet routing,
buffering, and diagnostics for multiple workers. Direct HTTP removes the gateway and wireless
modem requirement and is materially simpler for the current one-turtle deployment.

**Consequence:** The control plane and database must be transport-aware. Direct turtles need their
own bounded HTTP polling, durable cursor, event outbox, and update download path. Fleet rollout
remains gateway-only initially, and v1 reuses the shared gateway bearer secret; per-worker
credentials are future hardening.

## ADR-004 — Gateway-initiated HTTPS through a source-allowlisted public endpoint

**Decision:** Accepted; replaces the prior WireGuard baseline.

The ComputerCraft gateway or direct turtle makes outbound HTTPS requests to a public VPS hostname.
The TLS reverse proxy and VPS firewall admit the friend's verified Minecraft-host public address
(`51.161.113.44/32` initially); application-level gateway ID and bearer-secret authentication
remain mandatory. The control-plane process stays on a non-public listener; the current Docker
ingress integration uses a private bridge address rather than loopback.

**Rationale:** ComputerCraft already supports outbound HTTP requests, so a VPN adds setup burden
without being required for the request/poll model. HTTPS protects the bearer secret in transit;
the source allowlist reduces public exposure. This design still avoids a VPS-initiated connection
to ComputerCraft.

**Consequence:** Deployment requires a DNS hostname, trusted certificate, reverse proxy, and
verification that `51.161.113.44` is the host's actual egress address. If that address changes,
the allowlist must be updated before a gateway or direct turtle can reconnect.

## ADR-005 — Rednet/modem for gateway↔worker transport

**Decision:** Accepted.

Workers using `gateway-rednet` remain lightweight and local to the Minecraft world. This ADR does
not require direct HTTP workers to install a modem.

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
