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
   Preserve the extensionless `startup` file at the filesystem root. CraftOS uses it as the
   automatic boot hook and it launches the versioned `startup.lua` runtime.
2. Copy `gateway.conf.example` to `gateway.conf` and fill in the VPS URL, gateway ID, server ID,
   modem side, and the bearer secret locally.
3. Ensure a wired or wireless modem is attached on the configured side. The gateway cannot talk
   to turtles without a modem.
4. Reboot or run `startup`.

## Gateway-backed turtle

1. Copy the contents of `computercraft/turtle/` to the turtle filesystem.
   Preserve the extensionless `startup` file at the filesystem root. CraftOS uses it as the
   automatic boot hook and it launches the versioned `startup.lua` runtime.
2. Copy `worker.conf.example` to `worker.conf` and set a stable worker ID, the gateway computer
   ID, the modem side, and the Rednet protocol.
   For named-container transfers, add local IDs under `container_sides`, for example
   `container_sides = { ["test-chest"] = "front" }`.
3. Ensure the turtle has a compatible modem upgrade installed and fuel for any later movement
   canary.
4. Reboot or run `startup`.

## Direct HTTP turtle

The direct path is intended for a turtle that cannot use a wireless modem. It talks to the VPS
over ComputerCraft's outbound HTTPS API, so no gateway computer or modem is required.

1. Provision the worker from the protected VPS CLI:

   ```bash
   npm run cli -- provision-worker --id alice --server friends-server --computer-id 21 --version v0.4.0
   ```

2. Copy the contents of `computercraft/turtle/` to the turtle filesystem.
3. Copy `worker.conf.example` to `worker.conf` and set:

   ```lua
   transport = "direct-http",
   worker_id = "alice",
   minecraft_server_id = "friends-server",
   vps_url = "https://192.99.69.46.sslip.io:8443",
   vps_bearer_secret = "set-locally",
   runtime_version = "v0.4.0",
   ```

   Optionally configure named transfer sides, for example:

   ```lua
   container_sides = { ["test-chest"] = "front" },
   ```

4. Ensure the ComputerCraft HTTP allowlist permits the VPS hostname over HTTPS.
5. Reboot or run `startup`.

Do not set `modem_side`, `gateway_rednet_id`, or `rednet_protocol` for this transport. Verify the
worker with `npm run cli -- workers alice` after its registration and heartbeat arrive.

The stable bootstrap checks for the extensionless CraftOS `startup` hook during recovery and
recreates it if it is missing. It does not overwrite an existing hook or any configuration/state
file.

For a bounded target-aware mining canary, use the operator CLI only after the worker is online:

```bash
npm run cli -- gather alice minecraft:cobblestone 8 12
npm run cli -- deposit alice 8 --container-id test-chest
```

The final argument is the maximum forward depth. This command gathers only up to the explicit
bound; it does not yet navigate to or deposit into a named destination.

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

For a direct turtle, use the same operator command with an individual worker target. The turtle
downloads the immutable manifest and allowlisted files directly from GitHub on its next poll,
stages them, preserves its local files, and reports activation or rollback over
`/v1/worker/events`:

```text
npm run cli -- update --target worker:alice --version v0.4.0
```

The ComputerCraft HTTP API must be enabled and allow the configured public VPS hostname over HTTPS.
No WireGuard client or inbound Minecraft-host port is required: the gateway or direct turtle
initiates every HTTPS request. Before enabling the VPS allowlist, verify the Minecraft host's
outbound public address is `51.161.113.44`.
