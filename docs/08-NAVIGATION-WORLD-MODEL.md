# Navigation and World Model

## 1. Why navigation remains custom

ComputerCraft provides movement primitives, not global autonomous pathfinding. Navigation is therefore one of the main remaining engineering problems, but it is simpler than humanoid navigation because turtle movement is discrete and block-aligned.

State:

```text
(x, y, z, facing, dimension)
```

Actions:

```text
forward, back, up, down, turnLeft, turnRight
```

## 2. World cell model

Known cells SHOULD support classifications such as:

```text
UNKNOWN
FREE
SOLID_BREAKABLE
SOLID_UNBREAKABLE
HAZARDOUS
RESERVED
SPECIAL
```

Metadata MAY contain block IDs, observation time, hardness/tool hints, or transport semantics.

Online heartbeat positions, operator-confirmed anchors, and named-location endpoint writes also seed
their exact coordinate as a walkable `world_cells` record. A configured named-location approach
coordinate is seeded as well. This gives the planner trustworthy start/end anchors for a bounded
route without claiming that any unobserved neighboring cell is safe. Block observations and later
movement observations extend the known map incrementally.

The control plane applies a bounded freshness window to persisted world cells before planning or
returning the world-cell inspection view. `WORLD_CELL_MAX_AGE_SECONDS` defaults to 86,400 seconds
and can be shortened for worlds that change frequently. A stale cell is treated as unknown until a
new heartbeat, anchor, block observation, named-location write, or movement contradiction refreshes
that coordinate.

## 3. Planner boundary

The LLM SHOULD choose destination/strategy. A deterministic navigation engine SHOULD choose the actual path.

```text
Codex: travel to Mine Alpha
  ↓
Navigation engine: path cells + exploration/replan
  ↓
Turtle: movement primitives
```

## 4. A* baseline

A* over known cells is the default baseline.

Costs MAY include:

- movement = low;
- turn = small;
- breaking a block = material/tool/time cost;
- vertical movement = normal or configurable;
- unknown cell = exploration penalty;
- hazardous cell = prohibited/high cost;
- reserved cell = prohibited/high cost.

The implementation SHOULD start simple and profile before adding sophisticated heuristics.

## 5. Exploration

Unknown world areas SHALL be handled incrementally.

A navigation attempt MAY:

1. plan through known free space;
2. move to frontier;
3. inspect neighboring blocks;
4. update map;
5. replan;
6. repeat within budget.

No global ore/world scan is required.

## 6. Reconciliation

The navigation layer SHALL invalidate assumptions when:

- a move reports blocked unexpectedly;
- an expected block is missing/present;
- another worker changes the route;
- position confidence is suspect;
- a server restart or manual relocation occurred.

The current gather workflow implements a bounded form of this reconciliation: a blocked navigation
step records the contradicted cell and may replan from the turtle's reported position up to three
times. Frontier exploration and general-purpose replanning remain separate future work.

## 7. Named locations

Named locations anchor high-level plans:

```yaml
name: Main Warehouse
dimension: 0
position: { x: 112, y: 64, z: -30 }
approach: { x: 111, y: 64, z: -30, facing: E }
```

For turtles, an `approach`/dock coordinate is often more useful than the block coordinate itself.
The protected location API accepts this as an optional typed `approach` object. Route planning and
destination-aware workflows use it when present, while the block coordinate remains the physical
landmark and named identity.

## 8. Worker collision/reservation

Multi-turtle navigation SHOULD reserve short route segments or work areas to reduce deadlocks/collisions.

Initial implementation MAY use coarse reservations:

- one worker per narrow tunnel;
- build-region partitions;
- docking slots;
- short TTL cell reservations.

## 9. Dimensions

The world model SHALL namespace coordinates by dimension.

Cross-dimensional travel is represented as a transport graph:

```text
Overworld location
   ↓ walk
Portal A
   ↓ portal edge
Nether Portal A'
   ↓ walk
Destination
```

Turtles using portals MUST verify resulting dimension/position through available anchoring mechanisms before continuing autonomous destructive work.

## 10. Transport adapters

Later adapters MAY include:

- portals;
- minecarts/Railcraft where practical;
- teleport systems;
- mod-specific movement.

Turtle-compatible transport shall be validated per system; not every player transport is applicable to a turtle entity.
