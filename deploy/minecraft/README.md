# Minecraft-side deployment

The release workflow packages the files under `computercraft/` into
`dist/release/computercraft-lua.zip`:

```bash
npm ci
npm run release:lua
```

The archive contains the gateway and turtle Lua files, configuration templates, a manifest, and
this deployment guide. It does not contain populated configuration or secrets.

## Gateway computer

1. Extract the archive and copy the contents of `computercraft/gateway/` to the ComputerCraft
   computer filesystem.
2. Copy `gateway.conf.example` to `gateway.conf` and fill in the VPS URL, gateway ID, server ID,
   modem side, and the bearer secret locally.
3. Ensure a wired or wireless modem is attached on the configured side. The gateway cannot talk
   to turtles without a modem.
4. Reboot or run `startup`.

## Turtle

1. Copy the contents of `computercraft/turtle/` to the turtle filesystem.
2. Copy `worker.conf.example` to `worker.conf` and set a stable worker ID, the gateway computer
   ID, the modem side, and the Rednet protocol.
3. Ensure the turtle has a compatible modem upgrade installed and fuel for any later movement
   canary.
4. Reboot or run `startup`.

Use only the smallest read-only/registration canary first. Do not issue movement, mining, or
placement commands until the worker appears online in `computercraft-agents workers`.

## Manual paste fallback

If the friend cannot copy a host-side archive into the world, paste each Lua file into the
ComputerCraft editor or use an in-game disk. Preserve the directory-local module names because
the legacy CraftOS loader resolves modules from the current filesystem.

The gateway and turtle programs must be configured locally and must not receive secrets through
Git.

## Gateway-managed updates

Keep the stable `startup.lua`, `update_bootstrap.lua`, and `update_manager.lua` files installed on
each gateway/turtle. After that bootstrap, the VPS operator can queue a tagged release without
manual copy/paste:

```text
npm run cli -- update --target worker:alice --version v0.2.0
npm run cli -- update --target gateway:gateway-main --version v0.2.0
```

The gateway downloads `release-manifest.json` over HTTPS and transfers only managed runtime Lua
files over Rednet. `gateway.conf`, `worker.conf`, state, command caches, logs, and outbox files
are preserved. The turtle must be idle; activation uses a rollback journal and the stable
bootstrap. Inspect progress with `npm run cli -- update-status <update-id>`.

The gateway computer must have ComputerCraft HTTP enabled and allow the configured public VPS
hostname over HTTPS. No WireGuard client or inbound Minecraft-host port is required: the gateway
initiates every HTTPS request. Before enabling the VPS allowlist, verify the Minecraft host's
outbound public address is `51.161.113.44`.
