# Safety and Operations

## 1. Context

Development occurs on the live shared world. Safety here means preventing software defects, runaway loops, stale commands, and accidental blast radius. It is not intended to restrict the user's chosen gameplay permissions.

## 2. Required controls

Before autonomous block mutation:

- global stop;
- per-worker stop;
- command/action budgets;
- block-change budgets;
- capability enable/disable flags;
- canary worker limit;
- plan-only/dry-run mode;
- audit lineage;
- stale command expiry.

## 3. Global stop

`stop all` SHALL:

1. mark relevant work PAUSED in control plane;
2. send urgent stop controls through gateway;
3. turtles stop at next safe primitive boundary;
4. no queued autonomous mutation starts until resumed.

Stop SHALL NOT require Codex availability.

## 4. Capability gates

Example environment config:

```yaml
capabilities:
  navigation: stable
  inspect: stable
  mining: canary
  building: experimental
  ae2_read: canary
  ae2_write: disabled
  mekanism_write: disabled
  defensetech_fire: disabled
```

Maturity is operational state, not planner persuasion.

## 5. Budgets

Every physical command SHOULD support limits such as:

```text
max primitives
max block breaks
max block placements
max inventory transfers
max explored cells
max duration/iterations
```

A budget exhaustion event produces BLOCKED/FAILED/NEEDS_REPLAN rather than automatic unlimited continuation.

## 6. Outages

### VPS unreachable

Gateway:

- stops accepting new plans;
- buffers bounded results/events;
- tells turtles to finish safe primitive/current bounded command then idle;
- does not autonomously invent new goals.

### Codex unavailable, VPS healthy

- deterministic in-flight bounded action may finish;
- goal-level planning pauses;
- persisted queues remain;
- automatic reconcile/resume on recovery.

### Gateway restarts

- new boot ID;
- rediscover turtles;
- report current turtle state;
- VPS does not assume previous in-flight command completed.

### Turtle restarts

- re-register;
- report boot ID and local state;
- previous command considered uncertain unless idempotency record proves completion.

## 7. Live-world canary rules

Early testing SHOULD use:

- one turtle;
- small known area;
- small primitive budgets;
- cheap blocks/items;
- no DefenseTech firing;
- no broad recursive mining;
- no automated update without manual review.

These limits can be relaxed as capabilities become stable.

## 8. Destructive systems

DefenseTech does not require per-action confirmation by product policy. During implementation, destructive capabilities remain disabled until their adapter has passed canary acceptance tests.

All arm/fire actions SHALL be high-retention audit events.

## 9. No rollback subsystem

The application does not need to implement world rollback. Conventional server backups are operationally useful but outside project scope.
