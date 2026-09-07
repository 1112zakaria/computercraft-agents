# Communication Protocol

## 1. Protocol layers

Two application protocols are defined:

1. **VPS ↔ Gateway** over HTTP/JSON using the WireGuard network.
2. **Gateway ↔ Turtles** over Rednet/modem using compact versioned tables serialized by ComputerCraft.

They MAY share message concepts but SHOULD not be forced into identical wire formats.

## 2. VPS ↔ gateway model

For v1, the gateway SHOULD initiate outbound HTTP requests to the VPS. This avoids requiring ComputerCraft to host an HTTP server.

Preferred flows:

```text
POST /v1/gateway/register
POST /v1/gateway/heartbeat
GET  /v1/gateway/commands?after=<cursor>    # poll/long-poll
POST /v1/gateway/events                    # batched events/results
POST /v1/gateway/ack                       # optional explicit ack
```

Exact URLs are implementation details; semantic behavior is normative.

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

WireGuard authenticates network peers, but application-level gateway authentication SHOULD remain.

Possible v1 mechanism:

```text
X-Agent-Gateway-Id
Authorization: Bearer <gateway secret>
```

Secrets SHALL be distributed privately and never committed.

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

## 12. Versioning

- All messages SHALL carry a protocol version.
- Minor additive changes SHOULD preserve compatibility.
- Incompatible changes SHALL increment the major protocol version.
- Gateway SHALL reject commands requiring unsupported versions/capabilities.

## 13. Payload size

Commands SHOULD reference large blueprints/path batches by IDs/chunks rather than transmitting enormous objects repeatedly.

Building execution MAY use paged/chunked blueprint segments:

```text
blueprint.prepare
blueprint.chunk
blueprint.execute_chunk
```

## 14. Security validation

Gateway/turtles SHALL validate:

- worker target;
- known skill name;
- argument types/ranges;
- action budgets;
- command expiry;
- session/auth data;
- capability enablement.

A model-generated object SHALL never bypass protocol validation.
