# Mod Integration Strategy

## 1. Principle

Use the cheapest correct integration layer in this order:

1. vanilla turtle primitives;
2. existing ComputerCraft/OpenPeripheral peripheral methods;
3. existing mod automation interfaces (inventories, redstone, etc.);
4. small dedicated peripheral adapter mod;
5. only then broader custom Forge integration.

The project SHALL NOT recreate a general Forge worker runtime solely to reach one machine API.

## 2. Existing environment

The modpack contains, among others:

- ComputerCraft 1.75;
- Computronics;
- OpenPeripheralCore;
- OpenPeripheralIntegration;
- OpenPeripheralAddons;
- Applied Energistics 2;
- Mekanism + Generators + Tools;
- DefenseTech;
- Thaumcraft and multiple Thaumcraft addons;
- Thermal Expansion/Foundation/Dynamics;
- EnderIO;
- IC2;
- BuildCraft;
- ProjectRed;
- Railcraft;
- Forestry/Gendustry;
- PneumaticCraft;
- Botania;
- Blood Magic;
- Witchery;
- Mystcraft;
- Galacticraft;
- TConstruct;
- Twilight Forest.

Exact installed versions remain part of technical validation.

## 3. Compatibility matrix

| System | Priority | Turtle physical interaction | Existing peripheral potential | Likely custom work | Notes |
|---|---:|---:|---:|---:|---|
| Vanilla blocks/inventories | P0 | Strong | N/A | Low | Core worker substrate. |
| AE2 | P0 | Partial | **Strong candidate via OpenPeripheral** | Low/Medium | Validate storage query and transfer methods first. |
| Mekanism | P0 | Partial | Unknown/limited | Medium | Likely dedicated peripheral adapter for machine config/status. |
| DefenseTech | P0 | Partial | Unknown | Medium | May need adapter for configure/arm/fire; keep explicit capabilities. |
| Thaumcraft | P1 | Partial | Existing OpenPeripheral exposure for selected features | High for progression | Player-specific research/progression may remain unsuitable for turtles. |
| Thermal/CoFH | P2 | Strong generic | Existing peripheral potential | Low/Medium | Good automation target. |
| IC2 | P2 | Strong generic | Existing peripheral potential | Low/Medium | Machine status/energy may be exposed. |
| Railcraft | P2 | Generic + transport research | Existing peripheral potential | Medium | Useful for logistics/transport. |
| BuildCraft | P2 | Generic | Existing peripheral potential | Low/Medium | Pipes/machines may integrate well. |
| EnderIO | P2 | Generic | Verify | Medium | Machine config may need adapter. |
| Mystcraft | P3 | Partial | Existing peripheral potential | Medium/High | Dimension semantics complex. |
| Galacticraft | P3 | Partial | Verify | High | Turtle compatibility with rockets/transport uncertain. |

## 4. AE2 integration plan

Research and implement in this order:

1. enumerate peripherals/methods available in the exact installed OpenPeripheral/AE2 versions;
2. read stored item counts;
3. identify/deposit to/withdraw from ME-facing interfaces available to turtles;
4. map results to the common resource API;
5. add reservation/planner integration;
6. investigate autocrafting request support.

Desired semantic API:

```text
ae2.query(item) -> quantity
ae2.deposit(item, quantity)
ae2.withdraw(item, quantity)
ae2.request_craft(item, quantity)   # later, if available
```

## 5. Mekanism integration plan

First use generic placement/inventory automation. Then investigate a small ComputerCraft peripheral adapter exposing selected server-side machine APIs.

Potential semantic surface:

```text
mekanism.inspect(machine)
mekanism.energy(machine)
mekanism.inventory(machine)
mekanism.set_side_mode(machine, side, mode)
mekanism.set_auto_eject(machine, bool)
mekanism.inspect_gas(machine)
```

Do not expose raw reflection/arbitrary method calls to planners.

## 6. DefenseTech integration plan

Workers may autonomously manufacture/place/configure/arm/fire DefenseTech systems according to project policy.

Keep distinct capabilities:

```text
defensetech.manufacture
defensetech.place
defensetech.configure
defensetech.arm
defensetech.fire
```

These remain feature-gated during canary development and permanently audited.

## 7. Thaumcraft

Turtles are not players, so autonomous Thaumcraft progression may not map cleanly.

Treat Thaumcraft as two categories:

1. machine/world automation accessible through peripherals or physical block interaction;
2. player-bound research/progression, which MAY remain unsupported without a separate player-context adapter.

Do not let Thaumcraft complexity force the whole project back to a player-emulation architecture.

## 8. Dedicated peripheral adapter pattern

If a mod lacks ComputerCraft support, prefer a small server/client-compatible Forge addon that registers a peripheral around a target block/system.

```text
Mekanism block
   ↓
MinecraftAgentsPeripheralAddon
   ↓ ComputerCraft methods
Gateway / turtle
```

This isolates legacy Java work to narrow, testable integrations.

## 9. Research template

For each mod integration, record:

- exact mod JAR/version;
- available ComputerCraft/OpenPeripheral type names;
- `peripheral.getType` result;
- method list;
- read methods;
- write/configuration methods;
- physical turtle fallback actions;
- verification strategy;
- destructive operations;
- capability maturity state;
- minimal live-world canary test.
