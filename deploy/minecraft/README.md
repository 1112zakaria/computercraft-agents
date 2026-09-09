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

1. For a fresh or damaged installation, copy `install-gateway.lua` to the computer and run it
   with a reviewed immutable commit, for example:

   ```lua
   lua install-gateway.lua d6ab3881197ae7998e16e88db472b9a1dcc2ea03
   ```

   The installer downloads the pinned gateway files, preserves existing files in a backup
   directory, keeps `gateway.conf` and the outbox local, and repairs the extensionless CraftOS
   startup hook. If using the release ZIP, the installer is at the archive root.
2. Copy `gateway.conf.example` to `gateway.conf` if it does not exist and fill in the VPS URL,
   gateway ID, server ID, modem side, and the bearer secret locally.
3. Ensure a wired or wireless modem is attached on the configured side. The gateway cannot talk
   to turtles without a modem.
4. Reboot or run `startup`.

## Gateway-backed turtle

1. For a fresh or damaged installation, copy `install-direct.lua` to the turtle and run it with
   a reviewed immutable commit. The installer downloads the pinned turtle files, preserves
   existing files in a backup directory, keeps `worker.conf` and state local, and repairs the
   extensionless CraftOS startup hook. If using the release ZIP, the installer is at the archive
   root.
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
   npm run cli -- provision-worker --id alice --server friends-server --computer-id 21 --version v0.4.1
   ```

2. Copy the contents of `computercraft/turtle/` to the turtle filesystem. If using the release
   ZIP, also copy the root-level `enable-gather.lua` deployment utility to the turtle filesystem.
3. Copy `worker.conf.example` to `worker.conf` and set:

   ```lua
   transport = "direct-http",
   worker_id = "alice",
   minecraft_server_id = "friends-server",
   vps_url = "https://192.99.69.46.sslip.io:8443",
   vps_bearer_secret = "set-locally",
   runtime_version = "v0.4.1",
   ```

   Optionally configure named transfer sides, for example:

   ```lua
   container_sides = { ["test-chest"] = "front" },
   ```

4. Ensure the ComputerCraft HTTP allowlist permits the VPS hostname over HTTPS.
5. Reboot or run `startup`.

Do not set `modem_side`, `gateway_rednet_id`, or `rednet_protocol` for this transport. Verify the
worker with `npm run cli -- workers alice` after its registration and heartbeat arrive, then use
`npm run cli -- inspect alice` to request a bounded inventory snapshot.

If an existing `worker.conf` explicitly lists capabilities but omits the first-use gather skills,
run `lua enable-gather.lua`. The helper creates a `worker.conf.before-gather*` backup, adds only
`mining.gather`, `navigate.path`, and `inventory.deposit`, and preserves the bearer secret and
other settings. It also repairs a missing or malformed extensionless CraftOS `startup` hook,
retaining the previous copy as `startup.previous*`. Run `startup` afterward so the worker
re-registers with the updated list.

The stable bootstrap checks the extensionless CraftOS `startup` hook during recovery and repairs
it if it is missing, a directory, or malformed. The pinned `install-direct.lua` installer does the
same on initial installation. A valid existing hook is preserved; a malformed existing hook is
retained as `startup.previous*` inside the install backup before repair. Neither path overwrites
configuration or runtime state files.

For a bounded target-aware mining canary, use the operator CLI only after the worker is online:

```bash
npm run cli -- set-location "Test Chest" 0 10 64 -2 E --approach 0 9 64 -2 N
npm run cli -- path-to alice "Test Chest"
npm run cli -- go-to alice "Test Chest"
npm run cli -- observe alice front
npm run cli -- gather alice minecraft:cobblestone 8 12
npm run cli -- deposit alice 8 --container-id test-chest --item-key cobblestone
```

The final argument is the maximum forward depth. This command gathers only up to the explicit
bound. A named location's optional approach coordinate is used by `path-to` and the addressed
gather workflow so the turtle stops at a safe interaction position rather than entering the
container block.

`observe` is a bounded read-only block observation. It records the adjacent cell as walkable or
blocked in the VPS world model and can be repeated after a bounded movement to seed a known route.

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
npm run cli -- update --target worker:alice --version v0.4.1
```

The ComputerCraft HTTP API must be enabled and allow the configured public VPS hostname over HTTPS.
No WireGuard client or inbound Minecraft-host port is required: the gateway or direct turtle
initiates every HTTPS request. Before enabling the VPS allowlist, verify the Minecraft host's
outbound public address is `51.161.113.44`.
