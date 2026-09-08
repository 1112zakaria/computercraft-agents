# Open Questions and Technical Spikes

These items should be answered by targeted implementation/research, not additional broad product elicitation.

## OQ-001 — Exact Forge and Java builds

Confirm exact Forge 1.7.10 build and Java 8 build on the server.

## OQ-002 — ComputerCraft HTTPS public-endpoint behavior

**Status: RESOLVED — verified 2026-09-08.**

Verify the installed ComputerCraft 1.75 configuration can reach the configured public VPS
hostname over HTTPS, and verify that requests arrive from `51.161.113.44`.

Acceptance:

```text
Gateway Computer → HTTPS request → `https://192.99.69.46.sslip.io:8443` → HTTP 204
VPS ingress → source address `51.161.113.44` → request admitted
```

Friend-side canary:

```lua
local response, error_message = http.get(
  "https://192.99.69.46.sslip.io:8443/v1/gateway/connectivity"
)
print(response and response.getResponseCode() or error_message)
if response then response.close() end
```

Observed result: the ComputerCraft HTTP API returned a response table with no error, and
`response.getResponseCode()` returned `204`. The VPS firewall counters also recorded traffic on
the allow rule for `51.161.113.44/32`.

A timeout means the request did not originate from the allowlisted address or cannot reach the VPS;
any other response is diagnostic evidence to retain.

Authenticated canary for CC-053:

```lua
local response = http.get(
  "https://192.99.69.46.sslip.io:8443/v1/gateway/authenticated-connectivity",
  headers
)
print(response and response.getResponseCode() or "request failed")
if response then response.close() end
```

The expected result is `204`. This uses the same headers as the gateway runtime and confirms the
bearer secret without mutating gateway state.

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
