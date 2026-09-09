# Communication Protocol

## 1. Protocol layers

Two application protocols are defined:

1. **VPS ↔ Gateway** over gateway-initiated HTTPS/JSON to the public control-plane endpoint.
2. **Gateway ↔ Turtles** over Rednet/modem using compact versioned tables serialized by ComputerCraft.

They MAY share message concepts but SHOULD not be forced into identical wire formats.

## 2. VPS ↔ gateway model

For v1, the gateway SHALL initiate outbound HTTPS requests to the VPS. This avoids requiring
ComputerCraft to host an HTTP server and means the VPS never needs a new inbound connection to a
ComputerCraft computer.

Preferred flows:

```text
POST /v1/gateway/register
POST /v1/gateway/heartbeat
GET  /v1/gateway/commands?after=<cursor>    # poll/long-poll
POST /v1/gateway/events                    # batched events/results
POST /v1/gateway/ack                       # optional explicit ack
```

The command poll response also contains an `updates` collection. Update controls are persisted by
the VPS and delivered through this existing gateway-initiated poll; the VPS does not open an
inbound connection to ComputerCraft.

Exact URLs are implementation details; semantic behavior is normative.

## 2a. VPS ↔ direct worker model

Workers configured with `transport = "direct-http"` use the same outbound HTTPS ingress without a
gateway computer or modem:

```text
POST /v1/worker/register
POST /v1/worker/heartbeat
GET  /v1/worker/commands?after=<cursor>
POST /v1/worker/events
```

Each request includes:

```text
Authorization: Bearer <GATEWAY_BEARER_SECRET>
X-Agent-Worker-Id: alice
```

The worker ID in the header, authenticated request context, and JSON payload MUST agree. The
shared gateway bearer secret is a v1 deployment trade-off; a turtle that possesses it could
impersonate another worker. Per-worker credentials and rotation are future hardening.

Registration includes `protocolVersion`, `workerId`, `workerBootId`, `minecraftServerId`,
`computerId`, `runtimeVersion`, and `capabilities`. Heartbeats reuse the worker heartbeat shape
and add `minecraftServerId`. The poll response is:

```json
{
  "protocolVersion": 1,
  "serverTime": "2026-09-08T12:00:00.000Z",
  "commands": [],
  "stopControls": [],
  "updates": [],
  "nextCursor": "123"
}
```

The turtle persists `nextCursor` before processing newly delivered work. It uses bounded polling,
not long-polling, and retries with backoff. Commands, urgent stop controls, and direct update
controls use the same semantic envelopes as the gateway path. Direct updates are individual
worker rollouts; `fleet:<gateway-id>` remains gateway-only.

Direct event submission contains `workerId`, `workerBootId`, `batchId`, and a bounded list of
events. Each event has the worker identity and no `gatewayId`. Event IDs are deduplicated by the
control plane, so a durable turtle outbox can retry after an HTTP failure.

## 2b. Operator goal entry point

The protected operator API accepts the first narrow addressed gather goal:

```text
POST /v1/goals
GET  /v1/goals
GET  /v1/goals/:taskId/report
```

The request contains `protocolVersion`, `goalText`, `createdByPrincipal`, and an optional bounded
priority. In v1, `goalText` must match the deterministic form
`@worker get <quantity> <item> and deposit it in <location>`. The control plane validates the
sentence and persists a project, ready job, and ready task with the normalized resource arguments.
The job advertises the required `mining.gather`, `navigate.path`, and `inventory.deposit`
capabilities so scheduler assignment can reject incompatible workers. Goal tasks still require the
multi-step gather workflow. Goal creation persists a parent `resource.gather` task and a targeted
`mining.gather` workflow step; the bounded scheduler can dispatch that protocol-level child.
The normalized `targetWorkerId` is retained in task arguments and scheduler/database dispatch
checks enforce it, so an addressed goal cannot be silently assigned to another worker.

`GET /v1/goals/:taskId/report` is a protected, read-only completion view. The path may identify
the root goal task or any workflow child. The control plane resolves the containing project and
job and returns their statuses, the root task ID, the original goal text, and every task in the
workflow with its phase, status, assigned worker, attempt count, and last error. This gives an
operator one bounded report for deciding whether a goal is complete, paused for intervention,
blocked by missing world knowledge, or failed.

Named locations are managed through the protected operator API:

```text
POST /v1/locations
GET  /v1/locations
GET  /v1/locations/:name
GET  /v1/workers/:workerId/path-to/:locationName
```

Location writes are idempotent by name and store dimension, coordinates, optional facing, source,
confidence, and metadata. Location resolution is case-insensitive. The route-plan endpoint returns
a bounded deterministic path only through known walkable cells from the worker's latest observed
position; it never moves a worker and fails safely when position, dimension, or path knowledge is
insufficient. Ready tasks can be inspected and claimed with:

```text
GET  /v1/tasks
GET  /v1/tasks/runnable
GET  /v1/tasks/:taskId/planning-context
POST /v1/tasks/:taskId
POST /v1/tasks/:taskId/dispatch
POST /v1/tasks/:taskId/transition
POST /v1/scheduler/tick
```

The claim request contains `workerId`. The database rejects claims for offline workers, unmet
dependencies, already-claimed tasks, and workers with another active task.
`GET /v1/tasks/runnable` is a read-only operator view that applies the same ready-state and
dependency filters used by the database claim path.
The explicit dispatch path accepts `{ "protocolVersion": 1, "workerId": "alice" }`. It
atomically checks worker availability, task dependencies, required capabilities, and the
one-active-task constraint, then creates a bounded command containing `taskId`. Completion and
failure events correlate back to the task; a worker command cancellation caused by an urgent stop
maps the task to `PAUSED` and releases its worker claim so it can be resumed explicitly.
Only tasks whose `skillName` is already a protocol command skill are dispatched directly. When a
gather step completes, the repository advances the linked workflow to a known-cell navigation
step and then an allowlisted `inventory.deposit` step. Missing destination anchors, incomplete
positions, or unknown paths set the parent workflow to `BLOCKED`; the system never guesses a route.
The scheduler tick is an explicit bounded operator action that selects compatible online workers
for those same protocol-level tasks and invokes the atomic dispatch path once per selected worker.
It does not auto-dispatch multi-step goal workflows.
The transition request contains `{ "protocolVersion": 1, "status": "...", "reason": "..." }`
and is checked against the persisted task transition graph. When supplied, the reason is stored
in the task's error/context field for auditability. It is an explicit operator control path; it
does not itself dispatch a command or mark a physical action successful.

The planning-context endpoint assembles a bounded, read-only context from the persisted task,
target worker observation, advertised capabilities, and known world cells. It explicitly labels
the resulting prompt as untrusted data and does not invoke a reasoning provider.

The reasoning package now exposes a provider-neutral planner-trigger service. It accepts only the
bounded causes `goal.created`, `command.completed`, `command.failed`, `worker.blocked`,
`delegation.required`, and `replan.required`, deduplicates trigger IDs, assembles the same bounded
context, and returns a schema-validated planner decision. It does not mutate tasks or execute model
output; control-plane persistence and event wiring remain a subsequent step.

After a successful `observation.block` command, the turtle emits a `block.observed` event. The
control plane derives the inspected cell from the worker position/facing and persists it in the
dimension-namespaced world-cell model. Worker-state events also anchor the turtle's current cell
as known walkable. This is bounded observation storage; path planning still refuses unknown cells
and requires freshness/reconciliation work before it can be treated as a complete world map.

## 3. Gateway registration

Example:

```json
{
  "protocolVersion": 1,
  "gatewayId": "friends-server-gateway",
  "bootId": "gw-boot-9c12",
  "minecraftServerId": "friends-server",
  "workers": [
    {
      "workerId": "alice",
      "computerId": 21,
      "runtimeVersion": "0.1.0",
      "capabilities": ["move", "dig", "place", "inspect", "inventory"]
    }
  ]
}
```

## 4. Authentication

The HTTPS ingress SHALL admit only configured source CIDRs (initially `51.161.113.44/32`) and
terminate a publicly trusted TLS certificate. This network control does not identify a specific
gateway or replace application-level authentication.

Possible v1 mechanism for gateway requests:

```text
X-Agent-Gateway-Id
Authorization: Bearer <gateway secret>
```

Secrets SHALL be distributed privately and never committed.

Direct workers use the corresponding `X-Agent-Worker-Id` header with the same bearer secret.

## 5. Command envelope

```json
{
  "protocolVersion": 1,
  "commandId": "cmd-01J...",
  "workerId": "alice",
  "issuedAt": "...",
  "expiresAt": "...",
  "skill": "navigate.path",
  "arguments": {
    "steps": ["N", "N", "UP", "E"]
  },
  "budget": {
    "maxPrimitives": 100,
    "maxBlockChanges": 10
  }
}
```

Every mutation command SHALL carry a globally unique command ID.

### 5a. Bounded gathering command

The first target-aware mining primitive is deliberately narrower than the full
`resource.gather` task state machine. It accepts an item key, a requested quantity, and a maximum
forward depth:

```json
{
  "skill": "mining.gather",
  "arguments": {
    "itemKey": "minecraft:cobblestone",
    "quantity": 8,
    "maxDepth": 12
  }
}
```

The turtle checks its current inventory first, then inspects/digs one block ahead and advances
until the quantity is present or the depth bound is exhausted. It returns `TARGET_NOT_REACHED`
with partial progress when the bound is reached. It does not select a source location, navigate
to a named destination, or claim that the overall gather-and-deposit goal is complete; those
behaviors remain scheduler/task-state work.

## 6. Event envelope

```json
{
  "protocolVersion": 1,
  "eventId": "evt-01J...",
  "gatewayId": "friends-server-gateway",
  "workerId": "alice",
  "commandId": "cmd-01J...",
  "sequence": 1432,
  "type": "command.completed",
  "occurredAt": "...",
  "payload": {
    "position": {"x": 105, "y": 64, "z": -22, "facing": "E"}
  }
}
```

## 7. Important event types

Minimum set:

```text
worker.online
worker.offline
worker.state
command.accepted
command.started
command.progress
command.completed
command.failed
command.cancelled
movement.blocked
fuel.low
fuel.empty
inventory.changed
inventory.full
block.observed
peripheral.observed
protocol.error
```

`inventory.changed` events contain a bounded post-transfer inventory snapshot. The control plane
stores it on the latest worker observation, preserving the previously observed position when one
exists; this is observation data for later postcondition verification, not proof that a named
destination has been reached.

## 8. Idempotency

The VPS may retry HTTP requests; events/commands therefore require deduplication.

- `commandId` SHALL identify one intended execution.
- A turtle SHALL not execute the same completed command twice solely because the gateway retransmitted it.
- Gateway SHALL retain a bounded recent-command/result cache.
- Event ingestion SHALL be idempotent by `eventId`.

## 9. Ordering

Ordering SHALL only be guaranteed per worker/session where feasible.

The system SHALL use:

- `bootId` to detect gateway restarts;
- worker boot/session IDs to detect turtle restarts;
- monotonic per-session sequence numbers;
- timestamps for observability, not sole ordering authority.

## 10. Heartbeats

Gateway SHALL periodically report:

- gateway uptime/status;
- worker online/offline status;
- turtle last-seen times;
- current command IDs;
- protocol/runtime versions;
- optionally position/fuel summary.

VPS SHALL mark workers unavailable after configurable missed-heartbeat thresholds.

## 11. Stop semantics

A stop request SHALL have a dedicated control path and SHOULD not be blocked behind a long command queue.

```json
{
  "type": "worker.stop",
  "controlId": "ctl-...",
  "workerId": "alice"
}
```

Turtle skills SHALL check for cancellation between primitives.

## 12. Update controls and Rednet transfer

An operator update request has this shape:

```json
{
  "protocolVersion": 1,
  "updateId": "upd-01J...",
  "target": "worker:alice",
  "releaseVersion": "v0.2.0",
  "manifestUrl": "https://github.com/1112zakaria/computercraft-agents/releases/download/v0.2.0/release-manifest.json",
  "issuedAt": "2026-09-08T12:00:00.000Z",
  "expiresAt": "2026-09-08T12:30:00.000Z"
}
```

Targets are `gateway:<id>`, `worker:<id>`, or `fleet:<gateway-id>`. Release versions must be
immutable semver-like tags such as `v0.2.0`; HTTPS branch URLs are rejected. The poll response
adds `status`, `gatewayId`, and the resolved `workerIds` to each update control.

Gateway-to-turtle update messages are:

```text
worker.update.prepare
worker.update.file.begin
worker.update.file.chunk
worker.update.file.end
worker.update.activate
worker.update.abort
worker.update.ack
```

Every message carries the update ID, release version, gateway boot ID, and worker identity. File
messages carry an allowlisted relative path, chunk number, and total chunk count. Duplicate chunks
are idempotent. A stale gateway boot ID, unsafe path, missing chunk, expired update, or missing
acknowledgement fails the update safely.

Update lifecycle events include `worker.update.started`, `worker.update.staged`,
`worker.update.activated`, `worker.update.failed`, and `worker.update.rolled_back`; gateway
self-update uses the corresponding `gateway.update.*` events.

## 13. Versioning

- All messages SHALL carry a protocol version.
- Minor additive changes SHOULD preserve compatibility.
- Incompatible changes SHALL increment the major protocol version.
- Gateway SHALL reject commands requiring unsupported versions/capabilities.

## 14. Payload size

Commands SHOULD reference large blueprints/path batches by IDs/chunks rather than transmitting enormous objects repeatedly.

`inventory.deposit` and `inventory.withdraw` may carry a `containerId`. The worker must resolve
that ID through its local configured container allowlist and reject unknown IDs without a transfer.

Building execution MAY use paged/chunked blueprint segments:

```text
blueprint.prepare
blueprint.chunk
blueprint.execute_chunk
```

## 15. Security validation

Gateway/turtles SHALL validate:

- worker target;
- known skill name;
- argument types/ranges;
- action budgets;
- command expiry;
- session/auth data;
- capability enablement.

A model-generated object SHALL never bypass protocol validation.
