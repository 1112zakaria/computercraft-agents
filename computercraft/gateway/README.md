# ComputerCraft gateway

This directory contains the gateway runtime described in `docs/03-COMPUTERCRAFT-EXECUTION.md`.
It validates versioned worker messages, registers/heartbeats with the VPS, routes bounded commands,
buffers and acknowledges events, and sends urgent worker/global stops through Rednet.

Install `gateway.conf.example` as `gateway.conf` on the gateway computer and configure the VPS URL,
private bearer secret, modem side, and Minecraft server identity locally. The secret is never logged.
