import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  AddressResolutionRequestSchema,
  CommandSchema,
  DirectWorkerEventBatchSchema,
  DirectWorkerPollResponseSchema,
  DirectWorkerProvisionSchema,
  DirectWorkerRegistrationSchema,
  ErrorResponseSchema,
  EventBatchSchema,
  GatewayHeartbeatSchema,
  GatewayRegistrationSchema,
  StopControlSchema,
  UpdateControlSchema,
  UpdateRequestSchema,
  WorkerUpdateMessageSchema,
  WorkerUpdateAckSchema,
  isSupportedProtocolVersion,
} from "../packages/protocol/src/index";

const fixturesRoot = join(__dirname, "../packages/protocol/fixtures");

function fixture(path: string): unknown {
  return JSON.parse(readFileSync(join(fixturesRoot, path), "utf8")) as unknown;
}

test("valid v1 gateway, heartbeat, command, event, and stop fixtures parse", () => {
  const registration = GatewayRegistrationSchema.parse(fixture("valid/gateway-registration.json"));
  const heartbeat = GatewayHeartbeatSchema.parse(fixture("valid/gateway-heartbeat.json"));
  const command = CommandSchema.parse(fixture("valid/navigate-command.json"));
  const events = EventBatchSchema.parse(fixture("valid/event-batch.json"));
  const stopControls = fixture("valid/stop-controls.json") as unknown[];

  assert.equal(registration.protocolVersion, 1);
  assert.equal(heartbeat.workers[0]?.workerId, "alice");
  assert.equal(command.skill, "navigate.path");
  assert.equal(events.events[0]?.type, "command.completed");
  assert.equal(Array.isArray(stopControls), true);
  assert.equal(StopControlSchema.safeParse(stopControls[0]).success, true);
  assert.equal(StopControlSchema.safeParse(stopControls[1]).success, true);
});

test("registration defaults omitted optional capabilities but requires protocol version", () => {
  const registration = GatewayRegistrationSchema.parse({
    protocolVersion: 1,
    gatewayId: "gateway-1",
    bootId: "boot-1",
    minecraftServerId: "server-1",
    workers: [],
  });

  assert.deepEqual(registration.capabilities, []);
  assert.equal(
    GatewayRegistrationSchema.safeParse(fixture("invalid/registration-missing-version.json"))
      .success,
    false,
  );
});

test("unknown skills and malformed arguments are rejected", () => {
  assert.equal(
    CommandSchema.safeParse(fixture("invalid/command-unknown-skill.json")).success,
    false,
  );
  assert.equal(
    CommandSchema.safeParse(fixture("invalid/command-invalid-arguments.json")).success,
    false,
  );
});

test("bounded gather commands require a target and depth budget", () => {
  const command = CommandSchema.parse({
    protocolVersion: 1,
    commandId: "command-gather-1",
    workerId: "alice",
    issuedAt: "2026-09-08T12:00:00.000Z",
    expiresAt: "2026-09-08T12:10:00.000Z",
    budget: { maxPrimitives: 32, maxBlockChanges: 8 },
    skill: "mining.gather",
    arguments: { itemKey: "minecraft:cobblestone", quantity: 8, maxDepth: 8 },
  });
  assert.equal(command.skill, "mining.gather");
  assert.equal(
    CommandSchema.safeParse({
      ...command,
      arguments: { ...command.arguments, maxDepth: 65 },
    }).success,
    false,
  );
});

test("peripheral inspection accepts an optional bounded side", () => {
  const command = CommandSchema.parse({
    protocolVersion: 1,
    commandId: "command-peripheral-1",
    workerId: "alice",
    issuedAt: "2026-09-08T12:00:00.000Z",
    expiresAt: "2026-09-08T12:10:00.000Z",
    budget: { maxPrimitives: 1, maxBlockChanges: 0 },
    skill: "peripheral.inspect",
    arguments: { side: "front" },
  });
  assert.equal(command.skill, "peripheral.inspect");
  assert.equal(
    CommandSchema.safeParse({ ...command, arguments: { side: "diagonal" } }).success,
    false,
  );
  assert.equal(CommandSchema.safeParse({ ...command, arguments: {} }).success, true);
});

test("deposit commands may carry a canonical target item", () => {
  const command = CommandSchema.parse({
    protocolVersion: 1,
    commandId: "command-deposit-1",
    workerId: "alice",
    issuedAt: "2026-09-08T12:00:00.000Z",
    expiresAt: "2026-09-08T12:10:00.000Z",
    budget: { maxPrimitives: 1, maxBlockChanges: 0, maxInventoryTransfers: 1 },
    skill: "inventory.deposit",
    arguments: { itemKey: "minecraft:cobblestone", quantity: 8 },
  });
  assert.equal(command.arguments.itemKey, "minecraft:cobblestone");
  assert.equal(
    CommandSchema.safeParse({
      ...command,
      arguments: { ...command.arguments, itemKey: "not valid" },
    }).success,
    false,
  );
});

test("task-dispatched commands preserve task correlation", () => {
  const command = CommandSchema.parse({
    protocolVersion: 1,
    commandId: "command-task-1",
    taskId: "task-1",
    workerId: "alice",
    issuedAt: "2026-09-07T12:00:00.000Z",
    expiresAt: "2026-09-07T12:05:00.000Z",
    budget: { maxPrimitives: 1, maxBlockChanges: 0 },
    skill: "movement.step",
    arguments: { direction: "N" },
  });
  assert.equal(command.taskId, "task-1");
});

test("command events require command correlation and error responses are typed", () => {
  assert.equal(
    EventBatchSchema.safeParse(fixture("invalid/event-missing-command-id.json")).success,
    false,
  );

  const error = ErrorResponseSchema.parse({
    protocolVersion: 1,
    requestId: "req-1",
    error: {
      code: "INVALID_ARGUMENTS",
      message: "steps contains an unsupported direction",
      retryable: false,
    },
  });

  assert.equal(error.error.retryable, false);
  assert.equal(isSupportedProtocolVersion(error.protocolVersion), true);
  assert.equal(isSupportedProtocolVersion(2), false);
});

test("update controls require immutable releases and validate transfer envelopes", () => {
  const request = UpdateRequestSchema.parse({
    protocolVersion: 1,
    updateId: "update-1",
    target: "worker:alice",
    releaseVersion: "v0.2.0",
    manifestUrl:
      "https://github.com/1112zakaria/computercraft-agents/releases/download/v0.2.0/release-manifest.json",
    issuedAt: "2026-09-08T12:00:00.000Z",
    expiresAt: "2026-09-08T12:30:00.000Z",
  });
  const control = UpdateControlSchema.parse({
    ...request,
    status: "QUEUED",
    gatewayId: "gateway-main",
    workerIds: ["alice"],
  });
  assert.equal(control.releaseVersion, "v0.2.0");
  assert.equal(
    UpdateRequestSchema.safeParse({ ...request, releaseVersion: "main" }).success,
    false,
  );
  assert.equal(
    UpdateRequestSchema.safeParse({
      ...request,
      manifestUrl: "http://example.com/release-manifest.json",
    }).success,
    false,
  );

  const chunk = WorkerUpdateMessageSchema.parse({
    protocolVersion: 1,
    type: "worker.update.file.chunk",
    gatewayBootId: "boot-1",
    updateId: "update-1",
    releaseVersion: "v0.2.0",
    workerId: "alice",
    path: "computercraft/turtle/protocol.lua",
    chunkNumber: 0,
    totalChunks: 1,
    content: "return {}",
  });
  assert.equal(chunk.type, "worker.update.file.chunk");
  assert.equal(
    WorkerUpdateMessageSchema.safeParse({ ...chunk, path: "computercraft/turtle/../worker.conf" })
      .success,
    false,
  );
  assert.equal(
    WorkerUpdateAckSchema.safeParse({
      protocolVersion: 1,
      type: "worker.update.ack",
      gatewayBootId: "boot-1",
      updateId: "update-1",
      workerId: "alice",
      phase: "FILE_RECEIVED",
      chunkNumber: 0,
    }).success,
    true,
  );
});

test("direct worker transport schemas require worker-scoped identity", () => {
  const registration = DirectWorkerRegistrationSchema.parse({
    protocolVersion: 1,
    workerId: "alice",
    workerBootId: "worker-boot-1",
    minecraftServerId: "friends-server",
    computerId: 21,
    runtimeVersion: "v0.4.0",
    capabilities: ["movement.step"],
  });
  assert.equal(registration.workerId, "alice");

  const provision = DirectWorkerProvisionSchema.parse({
    protocolVersion: 1,
    transport: "direct-http",
    workerId: "alice",
    minecraftServerId: "friends-server",
    computerId: 21,
    runtimeVersion: "v0.4.0",
    capabilities: [],
  });
  assert.equal(provision.transport, "direct-http");

  const poll = DirectWorkerPollResponseSchema.parse({
    protocolVersion: 1,
    serverTime: "2026-09-08T12:00:00.000Z",
    commands: [],
    stopControls: [],
    updates: [],
    nextCursor: null,
  });
  assert.equal(poll.nextCursor, null);

  const events = DirectWorkerEventBatchSchema.safeParse({
    protocolVersion: 1,
    workerId: "alice",
    workerBootId: "worker-boot-1",
    batchId: "batch-1",
    events: [
      {
        protocolVersion: 1,
        eventId: "event-1",
        workerId: "alice",
        sequence: 1,
        type: "worker.state",
        occurredAt: "2026-09-08T12:00:00.000Z",
        payload: {
          state: "IDLE",
          position: null,
          fuel: null,
          currentCommandId: null,
        },
      },
    ],
  });
  assert.equal(events.success, true);
  assert.equal(
    DirectWorkerEventBatchSchema.safeParse({
      protocolVersion: 1,
      workerId: "alice",
      workerBootId: "worker-boot-1",
      batchId: "batch-1",
      events: [
        {
          protocolVersion: 1,
          eventId: "event-2",
          workerId: "alice",
          gatewayId: "gateway-main",
          sequence: 2,
          type: "worker.state",
          occurredAt: "2026-09-08T12:00:00.000Z",
          payload: {
            state: "IDLE",
            position: null,
            fuel: null,
            currentCommandId: null,
          },
        },
      ],
    }).success,
    false,
  );
});

test("clear-space block observations accept explicit or legacy omitted null", () => {
  const baseEvent = {
    protocolVersion: 1,
    eventId: "event-observation-clear",
    workerId: "alice",
    sequence: 3,
    type: "block.observed" as const,
    occurredAt: "2026-09-08T12:00:00.000Z",
    payload: {
      direction: "front" as const,
      position: {
        dimension: 0,
        x: 0,
        y: 64,
        z: 0,
        facing: "N" as const,
        confidence: "UNCERTAIN" as const,
      },
    },
  };
  assert.equal(
    DirectWorkerEventBatchSchema.safeParse({
      protocolVersion: 1,
      workerId: "alice",
      workerBootId: "worker-boot-1",
      batchId: "batch-observation-omitted",
      events: [baseEvent],
    }).success,
    true,
  );
  assert.equal(
    DirectWorkerEventBatchSchema.safeParse({
      protocolVersion: 1,
      workerId: "alice",
      workerBootId: "worker-boot-1",
      batchId: "batch-observation-null",
      events: [{ ...baseEvent, payload: { ...baseEvent.payload, block: null } }],
    }).success,
    true,
  );
});

test("address resolution requests require a bounded protocol-versioned command", () => {
  assert.deepEqual(
    AddressResolutionRequestSchema.parse({ protocolVersion: 1, commandText: "@miners inspect" }),
    { protocolVersion: 1, commandText: "@miners inspect" },
  );
  assert.equal(
    AddressResolutionRequestSchema.safeParse({ protocolVersion: 1, commandText: "" }).success,
    false,
  );
  assert.equal(
    AddressResolutionRequestSchema.safeParse({ protocolVersion: 2, commandText: "@miners inspect" })
      .success,
    false,
  );
});
