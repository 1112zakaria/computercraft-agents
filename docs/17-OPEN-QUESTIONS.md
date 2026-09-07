# Open Questions and Technical Spikes

These items should be answered by targeted implementation/research, not additional broad product elicitation.

## OQ-001 — Exact Forge and Java builds

Confirm exact Forge 1.7.10 build and Java 8 build on the server.

## OQ-002 — ComputerCraft HTTP private-address behavior

Verify the installed ComputerCraft 1.75 configuration can reach the VPS WireGuard address and chosen port.

Acceptance:

```text
Gateway Computer → HTTP request → 10.50.0.1:<port> → successful response
```

## OQ-003 — Wireless modem/rednet range and loaded chunks

Determine practical modem topology, relay needs, and how turtles behave when moving outside chunks where gateway/relay infrastructure is loaded.

This can materially affect long-distance autonomy.

## OQ-004 — Turtle chunk-loading behavior

Determine whether active turtles keep relevant chunks loaded in this server/modpack and what occurs while no human players are online. If not sufficient, determine whether an existing chunk-loader mod/system can be used.

This is a key requirement for unattended work.

## OQ-005 — Position anchoring

Choose initial location strategy:

- manual known start coordinate;
- ComputerCraft GPS if practical;
- docking stations/landmarks;
- server/peripheral coordinate provider;
- a combination.

Dead reckoning alone is insufficient after manual relocation.

## OQ-006 — Minecraft chat relay

Determine whether the current pack already exposes chat to ComputerCraft. If not, choose between a safe compatible chat peripheral addon and a tiny Forge chat relay.

## OQ-007 — OpenPeripheral exact AE2 surface

Enumerate actual peripheral types/methods exposed by the installed versions. Do not design against generic documentation alone.

## OQ-008 — Mekanism peripheral feasibility

Determine whether any installed integration already exposes Mekanism. Otherwise inspect 9.1.1 APIs and design the smallest dedicated peripheral adapter needed.

## OQ-009 — DefenseTech peripheral feasibility

Determine APIs needed for manufacture/configure/arm/fire and whether generic block/redstone interaction covers part of the use case.

## OQ-010 — Cross-dimensional turtle travel

Test portals and other transports with turtles, including coordinate reconciliation after crossing.

## OQ-011 — Inventory/container semantics

Validate `suck`/`drop` behavior against the important modded inventories and identify containers that require peripheral-specific transfer.

## OQ-012 — Natural-language build representation

Choose blueprint schema and whether design generation happens fully in TypeScript/Codex structured output or through a separate deterministic design library.

## OQ-013 — Codex invocation method

v1 intends Codex CLI. Finalize subprocess/SDK wrapper behavior, authentication, structured output, cancellation, model/effort mapping, and concurrency implementation.

## OQ-014 — Resource/recipe source

Determine how recipes for the legacy modpack are made available to planning: static registry extraction, curated skill knowledge, NEI/Forge data export, or other source.
