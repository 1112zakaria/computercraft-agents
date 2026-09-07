# ComputerCraft Execution Model

## 1. Execution topology

The Minecraft-side implementation consists of:

1. one **gateway computer** connected to the VPS through ComputerCraft HTTP over the host's WireGuard route;
2. one or more **worker turtles** communicating with the gateway over Rednet/wireless modems;
3. optional **peripheral computers** attached to AE2 or other machines when useful.

```text
VPS
 │
 │ HTTP/JSON
 ▼
Gateway Computer
 │
 │ Rednet
 ├──────────────┬──────────────┐
 ▼              ▼              ▼
Alice Turtle    Bob Turtle     Charlie Turtle
```

## 2. Gateway runtime responsibilities

Gateway Lua modules SHOULD include:

```text
gateway/
  startup.lua
  config.lua
  http_client.lua
  protocol.lua
  dispatcher.lua
  worker_registry.lua
  outbox.lua
  heartbeat.lua
  logging.lua
  update.lua
```

The gateway SHALL:

- identify itself to the VPS;
- send a protocol version and capability set;
- poll or long-poll for commands;
- route commands to worker IDs;
- correlate responses with request IDs;
- relay asynchronous worker events;
- buffer a bounded number of events during temporary outages;
- deduplicate acknowledged event batches;
- report online/offline worker heartbeats;
- reject incompatible protocol versions.

## 3. Turtle runtime responsibilities

Suggested modules:

```text
turtle/
  startup.lua
  config.lua
  protocol.lua
  rednet_client.lua
  state.lua
  inventory.lua
  movement.lua
  observation.lua
  executor.lua
  cancellation.lua
  skills/
    move_path.lua
    inspect.lua
    mine.lua
    deposit.lua
    withdraw.lua
    build.lua
    craft.lua
    refuel.lua
```

The turtle runtime SHALL be deterministic and bounded.

## 4. Primitive API

The internal primitive layer SHOULD normalize ComputerCraft APIs into typed results.

Example conceptual contract:

```text
move(direction) ->
  OK(new_position)
  BLOCKED(observation)
  NO_FUEL
  CANCELLED
  ERROR(details)

dig(direction) ->
  OK(block_removed)
  NOTHING_TO_DIG
  UNBREAKABLE
  TOOL_REQUIRED
  CANCELLED
  ERROR(details)
```

The rest of the system SHOULD avoid interpreting only booleans/strings from raw turtle APIs.

## 5. Position/orientation tracking

Turtles do not inherently provide global coordinates through the basic Turtle API. v1 SHALL therefore maintain dead-reckoned state:

```text
x, y, z
facing ∈ {N,E,S,W}
dimension
confidence
last_anchor_at
```

Every successful movement updates state atomically.

Position MUST be treated as uncertain after:

- manual player movement/replacement of a turtle;
- teleportation by another mod;
- server-side relocation;
- corrupted local state;
- detected impossible observation.

The design SHOULD support anchor/recalibration mechanisms later (GPS, known docking station, coordinates supplied through another peripheral/API, or manual re-anchor command).

## 6. Worker state machine

```text
BOOTING
  ↓
REGISTERING
  ↓
IDLE ◄────────────┐
  │               │
  ▼               │
EXECUTING ──done──┤
  │               │
  ├─stop────────► PAUSED
  │               │
  ├─blocked─────► BLOCKED
  │               │
  └─fault───────► FAULTED
```

`PAUSED` SHALL preserve job context but execute no movement or mutation until resume/new authoritative command.

## 7. Atomic action semantics

A primitive is atomic only at the Lua/runtime contract level. Examples:

- one `turtle.forward()`;
- one `turtle.dig()`;
- one `turtle.place()`;
- one inventory transfer;
- one peripheral call.

Long skills MUST check cancellation/budgets between primitives.

Example:

```text
for each step in path:
    check_cancel()
    check_budget()
    move_one_step()
```

## 8. Fuel

If the server has turtle fuel enabled:

- fuel level SHALL be observed;
- each movement plan SHALL estimate minimum fuel plus reserve;
- refueling SHALL be a deterministic skill;
- the scheduler SHALL avoid assigning unreachable work based on known fuel constraints;
- `OUT_OF_FUEL` SHALL produce a recoverable blocked state, not a tight retry loop.

If unlimited fuel is configured, the capability handshake SHALL report that fact.

## 9. Inventory

A turtle's 16 slots are a hard execution constraint.

The runtime SHALL support:

- slot inventory snapshot;
- item counts;
- selected slot;
- deterministic slot selection;
- reserved slots for fuel/tools if configured;
- fullness threshold events;
- deposit/withdraw operations;
- verification after transfer.

High-level resource planning lives on the VPS.

## 10. Local safety

Even without the VPS, turtle code SHALL protect against obvious software runaway:

- maximum primitive count per command;
- maximum wall-clock/runtime per command where feasible;
- periodic cancellation checks;
- no infinite `while true dig/move` loop without a bounded objective;
- stop on protocol/session loss after a bounded grace period;
- never accept untrusted Rednet commands lacking session/auth correlation.

## 11. Updates

Turtle/gateway Lua code SHOULD support a controlled update mechanism from a trusted repository/release artifact, but automatic self-update SHALL NOT be required for the first milestone.

Because the friend operates the server manually, deployment tooling SHOULD package Lua files into a simple directory bundle and include exact copy/install instructions.
