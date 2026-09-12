# MVP relay

This directory is the current development target. It is intentionally separate from the frozen
future platform under `apps/`, `packages/`, and the existing gateway runtime.

The relay is a small, sequential job queue for one ComputerCraft turtle:

```text
agent / curl -> POST /api/v1/jobs -> relay-data.json
                                      ^
                                      |
                         turtle_poller.lua polls /next
                                      |
                         turtle executes Lua and posts /result
```

It uses Node.js built-ins only. The API shape follows the proven `cc-relay` design: JSON for the
writer and operator surfaces, plain text for the old-ComputerCraft poll and result paths, and a
lease for retrying jobs that disappear mid-run.

## Run

From the repository root:

```text
npm run mvp:relay
npm run agent -- "mine 8 cobblestone and deposit it in the chest"
```

The relay defaults to `http://127.0.0.1:8788` and stores its queue in
`relay/relay-data.json`. Configure the agent with `RELAY_URL` and `RELAY_WORKER_ID`; the worker
defaults to `alice`.

The default listener is loopback. For a turtle connecting directly to a relay on another host,
start the relay with `RELAY_HOST=0.0.0.0` (or use a private tunnel) and keep the port limited to the
trusted Minecraft server.

PowerShell example:

```powershell
$env:RELAY_URL = "http://relay-host:8788"
$env:RELAY_WORKER_ID = "alice"
npm run agent -- "mine 8 cobblestone and deposit it in the chest"
```

`agent.mjs` invokes the installed `codex` CLI and asks for only Lua source. The first canary
assumes the turtle starts at the mouth of a straight one-block-wide stone tunnel, has enough fuel,
and has a chest directly below its starting tile. The generated job mines forward, returns, and
drops the mined items into that chest.

## Turtle setup

Copy `turtle_poller.lua` to the turtle, set `RELAY_URL` and `WORKER_ID`, ensure the ComputerCraft
HTTP whitelist allows the relay host, and run it. The poller runs one job at a time and uses
plain-text HTTP responses so it does not depend on JSON support in the legacy runtime.

Press `Ctrl+T` on the turtle to interrupt the current Lua job. An operator stop can be queued for
the worker with:

```text
curl -X POST http://relay-host:8788/api/v1/stop \
  -H "Content-Type: application/json" \
  -d '{"worker_id":"alice","reason":"operator stop"}'
```

The stop is checked at the job boundary. A currently running program can still be interrupted
locally with `Ctrl+T`.

## Optional auth

Authentication is disabled by default for this private MVP:

```text
RELAY_AUTH_ENABLED=false
```

To enable the optional bearer check:

```text
RELAY_AUTH_ENABLED=true
RELAY_SECRET=replace-locally
```

When enabled, the agent and turtle must be configured with the same secret. Do not expose the
unauthenticated relay beyond the trusted Minecraft network/server.
