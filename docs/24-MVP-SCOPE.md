# MVP Relay Scope

## Status

Current development target. The existing control-plane architecture is frozen as the future
platform and is not part of the MVP runtime.

## Product contract

One operator or AI client submits one bounded Lua job to one ComputerCraft turtle. The turtle
polls, runs the job sequentially, reports success or failure, and the operator can inspect the
result. The first live goal is:

```text
agent "mine 8 cobblestone and deposit it in the chest"
```

## MVP components

- `relay/server.mjs`: dependency-free Node HTTP relay and JSON-backed queue.
- `relay/agent.mjs`: thin Codex CLI adapter that submits generated Lua.
- `relay/turtle_poller.lua`: ComputerCraft 1.75-compatible poller and result reporter.
- `relay/relay-data.json`: local queue state, ignored by Git.

The relay has no worker registry, scheduler, database, project model, or multi-agent coordination.
The single worker ID is supplied by the poll query and optional job target.

## Deferred future-platform work

The following remain documented but frozen: PostgreSQL and migrations; gateway/Rednet transport;
scheduler, projects, groups, delegation, memory, and conversations; world mapping, A*, named
locations, and multi-agent coordination; Minecraft chat; OTA updates; mod integrations;
dashboards; and advanced audit/observability.

## Authentication and operational boundary

`RELAY_AUTH_ENABLED=false` is the default. When enabled, `RELAY_SECRET` protects the API with a
bearer header. The MVP assumes the relay is reachable only through the trusted Minecraft network
or server whitelist. Local `Ctrl+T`, one-job-at-a-time execution, and lease-based retry remain
because they are needed for basic operation and recovery rather than as an enterprise security
layer.

## Live acceptance fixture

Use one turtle named `alice`, enough fuel, a straight stone tunnel at least eight blocks forward,
and a chest directly below the turtle's starting tile. Whitelist the relay host in ComputerCraft,
start the relay, start `turtle_poller.lua`, and run the acceptance command. The job is accepted
only when the turtle mines eight blocks, returns to the starting tile, deposits the resulting
cobblestone, and the relay reports `done`.
