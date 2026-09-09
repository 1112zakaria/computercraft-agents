# First-use runbook

This runbook is the shortest path from a healthy direct-HTTP canary to the first useful
resource workflow. It assumes the modem-less direct transport is the primary path and that the
control plane is already reachable over HTTPS.

## Current proven baseline

- `alice` can register and heartbeat over direct HTTP.
- bounded movement and inventory inspection have been validated live;
- an individual OTA update and reboot have been validated live;
- the runtime release contains the stable CraftOS startup hook and the `enable-gather.lua`
  migration helper;
- automatic post-reboot startup-hook behavior still needs a live validation after the installer
  or helper has been run once (tracked in GitHub issue #7).

## Prepare the turtle once

Install the pinned direct runtime from a reviewed commit or release, preserving `worker.conf` and
local state. If using a release ZIP, copy `install-direct.lua` from its root. On the turtle, run:

```lua
lua install-direct.lua <40-character-commit>
```

Then run the first-use capability migration:

```lua
lua enable-gather.lua
startup
```

The helper creates a backup before adding the first-use capabilities and repairs a missing or
malformed extensionless CraftOS `startup` hook, preserving the previous hook as
`startup.previous*`. It does not change the worker identity, transport, VPS URL, bearer secret,
or local state. Confirm the turtle has re-registered before continuing:

```bash
CONTROL_PLANE_URL=http://172.18.0.1:8787 npm run cli -- workers alice
```

The worker should be `online: true` and advertise at least:

```text
mining.gather
navigate.path
inventory.deposit
peripheral.inspect
```

## Establish the bounded world preconditions

The control plane intentionally does not guess the turtle's position or chest side.

1. Put the turtle at a known safe anchor and record it:

   ```bash
   npm run cli -- anchor alice <dimension> <x> <y> <z> <facing>
   ```

2. Record the named destination and its safe approach coordinate:

   ```bash
   npm run cli -- set-location "Test Chest" <dimension> <x> <y> <z> <facing> \
     --approach <dimension> <x> <y> <z> <facing>
   ```

3. Configure the matching local chest side in `worker.conf` and verify it is physically correct.
   The control plane cannot inspect that local side configuration.

4. Seed or verify a known walkable route. Use bounded observation/movement commands and inspect
   the route before creating a gather goal; a route through unknown cells is rejected rather than
   guessed. The operator command for a relative observation is:

   ```bash
   npm run cli -- observe alice front
   ```

   Repeat it for `up` or `down` where needed, and after each bounded move when seeding a route.

5. Run the read-only preflight:

   ```bash
   npm run cli -- goal-preflight "@alice get 8 cobblestone and deposit it in Test Chest"
   ```

Do not create the goal until preflight reports no blockers.

Each physical-world blocker includes a safe remediation hint. The preflight does not guess
coordinates or mutate the turtle: the operator must verify the turtle's anchor, named destination,
container side, and known route before starting work.

## Execute the first useful workflow

Create and start the bounded goal:

```bash
npm run cli -- goal "@alice get 8 cobblestone and deposit it in Test Chest" --start
```

`--start` performs one scheduler tick. If the turtle is busy or the workflow produces its next
step after a later event, run another bounded tick:

```bash
npm run cli -- scheduler-tick
npm run cli -- goal-report <task-id>
```

The optional background scheduler can perform these ticks automatically after review by setting
`SCHEDULER_ENABLED=true` on the control plane. It never bypasses capability, target, route, or
stop-control checks.

The acceptance evidence is:

1. the gather command reports `status: OK`, the canonical item key, and the requested quantity;
2. navigation reaches the known chest approach coordinate;
3. the deposit result reports the requested transfer and includes post-transfer inventory
   evidence;
4. `goal-report` shows the root task, job, and project completed, together with the latest
   command status and worker event payload used as completion evidence;
5. the worker remains online after the workflow.

## Known blockers

- A gateway-Rednet live canary still requires wireless modems and is independent of the direct
  path.
- Live automatic startup-hook validation requires a Minecraft window or manual in-game input.
- A physical chest-side mismatch, unknown route, insufficient fuel, or missing gather capability
  must be corrected in the game; the control plane reports the blocker but does not guess or
  mutate those local conditions.
