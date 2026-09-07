# ComputerCraft turtle runtime

This directory contains the deterministic turtle runtime described in
`docs/03-COMPUTERCRAFT-EXECUTION.md`. The runtime validates commands, tracks position, applies
bounded movement/observation/inventory/fuel actions, emits heartbeats/events, handles urgent stops,
and persists a bounded command idempotency cache.

Install `worker.conf.example` as `worker.conf` on the turtle and configure the gateway computer ID
and modem side locally. The runtime never executes arbitrary Lua received over Rednet.
