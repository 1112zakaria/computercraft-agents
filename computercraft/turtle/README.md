# ComputerCraft turtle runtime

This directory contains the deterministic turtle runtime described in
`docs/03-COMPUTERCRAFT-EXECUTION.md`. The runtime validates commands, tracks position, applies
bounded movement/observation/inventory/fuel actions, emits heartbeats/events including post-transfer
inventory snapshots, handles urgent stops,
and persists a bounded command idempotency cache.

The initial mining implementation supports a bounded one-block-wide, one-block-high tunnel via
`mining.excavate`; wider box patterns are rejected until their turning and rollback behavior is
tested.

Install `worker.conf.example` as `worker.conf` on the turtle and choose one transport locally.
`gateway-rednet` requires the gateway computer ID, modem side, and Rednet protocol. The
`direct-http` transport requires the VPS URL, worker/server identity, and bearer secret, but no
modem or gateway ID. The runtime never executes arbitrary Lua received over Rednet or HTTP.
