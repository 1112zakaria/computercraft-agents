# Minecraft-side deployment

The friend-side installation workflow will package the files under `computercraft/` in a later
release task. The gateway and turtle programs must be configured locally and must not receive
secrets through Git.

The gateway computer must have ComputerCraft HTTP enabled and allow the configured public VPS
hostname over HTTPS. No WireGuard client or inbound Minecraft-host port is required: the gateway
initiates every HTTPS request. Before enabling the VPS allowlist, verify the Minecraft host's
outbound public address is `51.161.113.44`.
