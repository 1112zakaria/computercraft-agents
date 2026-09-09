# Skills and Capabilities

## 1. Principle

Codex plans using semantic skills. Lua executes deterministic primitives.

```text
Natural-language goal
      ↓
Planner skill invocation
      ↓
Deterministic skill implementation
      ↓
Turtle/peripheral primitives
```

## 2. Capability naming

Suggested hierarchy:

```text
movement.step
navigation.route
observation.block
inventory.inspect
inventory.deposit
inventory.withdraw
mining.excavate
mining.gather_resource
building.place_blueprint
crafting.craft
fuel.refuel
peripheral.call
ae2.inspect_storage
ae2.withdraw
ae2.deposit
mekanism.inspect
defensetech.arm
defensetech.fire
```

Capabilities SHALL be versionable if semantics change materially.

## 3. Maturity states

```text
UNIMPLEMENTED
EXPERIMENTAL
CANARY
STABLE
DISABLED
```

The scheduler SHALL only use capabilities enabled by environment and policy.

## 4. Primitive layer

Lua primitives:

- move one block;
- turn;
- dig front/up/down;
- place front/up/down;
- inspect front/up/down;
- attack front/up/down where supported;
- select/equip;
- suck/drop;
- craft;
- peripheral call.

These SHOULD never be directly exposed as unconstrained LLM tools.

## 5. Navigation skill

Input:

```json
{
  "destination": {"dimension": 0, "x": 100, "y": 64, "z": -20},
  "policy": "explore_if_needed"
}
```

Output states:

```text
ARRIVED
BLOCKED
POSITION_UNCERTAIN
OUT_OF_FUEL
CANCELLED
FAILED
```

## 6. Resource gathering

`gather_resource` SHALL:

1. determine source strategy/location;
2. reserve destination capacity/resources if applicable;
3. navigate/explore;
4. gather until quantity target or blocking condition;
5. handle inventory full state;
6. deliver to destination;
7. verify delivered quantity;
8. report completion/failure.

The current deterministic runtime slice exposes the narrower `mining.gather` command for a
target item, quantity, and explicit maximum tunnel depth. It checks the existing inventory,
inspects and digs one block ahead at a time, and stops with `TARGET_NOT_REACHED` when the depth
bound is exhausted. It is intentionally not yet the full location-aware gather state machine
described above.

The domain package now contains a pure gather workflow contract with the phases
`CHECK_INVENTORY`, `GATHER`, `NAVIGATE_DESTINATION`, `DEPOSIT`, `VERIFY`, `COMPLETED`, and
`BLOCKED`. It emits at most one next action per observation and treats an exhausted gathering
bound or failed delivery as a terminal blocked state. Persistent task linkage and scheduler
dispatch still need to consume this contract.

## 7. Excavation

Turtles are especially suitable for bounded grid work.

Examples:

```text
excavate_box(origin, width, height, depth)
dig_tunnel(start, direction, length, cross_section)
clear_layer(bounds)
```

The current deterministic runtime slice exposes `mining.excavate` for a bounded
one-block-wide, one-block-high tunnel. The operator CLI invokes it with, for example,
`npm run cli -- excavate alice 1 1 8`. Wider box patterns remain explicitly unsupported until
their turn, fuel, inventory, and rollback behavior is tested.

Every excavation SHALL have explicit bounds.

## 8. Building

Building execution SHOULD operate from a normalized blueprint:

```text
Blueprint
  origin
  dimensions
  palette/material mapping
  placements[] = relative coordinate + block/item requirement
  optional order constraints
```

Planner-generated architecture is converted to a blueprint before physical placement.

Execution SHALL:

- reserve/obtain materials;
- partition placements;
- navigate to valid placement positions;
- place blocks;
- verify target cells where inspection permits;
- avoid repeating already-correct placements.

## 9. Inventory transfer

Generic container interaction SHOULD first attempt turtle `suck`/`drop` semantics.

The runtime supports an optional `containerId` on deposit/withdraw commands. The turtle resolves
that stable ID through the local `container_sides` allowlist in `worker.conf`; unknown IDs fail
before any transfer. The mapping currently supports `front`, `up`, and `down`, and does not
silently choose a different container.

Higher-level inventory knowledge MAY come from peripherals.

All transfer skills SHALL verify postconditions when possible.

## 10. Crafting

Use turtle crafting where recipes and turtle configuration permit.

The control plane SHOULD maintain a recipe/planning abstraction separate from execution so future AE2 autocrafting can satisfy the same semantic request.

## 11. Peripheral skills

Peripheral methods SHALL be wrapped in named typed skills rather than dynamically exposing arbitrary method invocation to the LLM.

Good:

```text
ae2.get_available(item)
ae2.withdraw(item, qty)
```

Avoid:

```text
call_arbitrary_peripheral(method, args_from_model)
```

for destructive/privileged operations.

## 12. Verification contracts

Every skill SHOULD define a success test.

Examples:

- mining: requested quantity delivered;
- movement: destination reached within tolerance;
- build: target blueprint cells match expected material where observable;
- inventory transfer: destination count increased as intended;
- automation: end-to-end output observed;
- DefenseTech: requested configuration/action state observed where possible.
