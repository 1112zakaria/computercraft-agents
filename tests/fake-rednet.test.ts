import assert from "node:assert/strict";
import test from "node:test";

import {
  CommandSchema,
  EventBatchSchema,
  EventSchema,
  StopControlSchema,
  WorkerRegistrationSchema,
} from "@computercraft-agents/protocol";

type RednetFrame = {
  readonly senderId: number;
  readonly recipientId: number;
  readonly protocol: string;
  readonly payload: string;
};

class FakeRednet {
  private readonly queues = new Map<number, RednetFrame[]>();

  public send(senderId: number, recipientId: number, protocol: string, message: unknown): void {
    const queue = this.queues.get(recipientId) ?? [];
    queue.push({ senderId, recipientId, protocol, payload: JSON.stringify(message) });
    this.queues.set(recipientId, queue);
  }

  public receive(recipientId: number, protocol: string): unknown {
    const queue = this.queues.get(recipientId) ?? [];
    const index = queue.findIndex((frame) => frame.protocol === protocol);
    if (index < 0) {
      return undefined;
    }
    const [frame] = queue.splice(index, 1);
    this.queues.set(recipientId, queue);
    return {
      senderId: frame!.senderId,
      message: JSON.parse(frame!.payload) as unknown,
    };
  }
}

const protocol = "computercraft-agents-v1";
const gatewayId = 4;
const turtleId = 7;
const workerId = "alice";
const gatewayBootId = "gw-boot-1";

function movementCommand() {
  return CommandSchema.parse({
    protocolVersion: 1,
    commandId: "command-move-1",
    workerId,
    issuedAt: "2026-09-08T08:00:00.000Z",
    expiresAt: "2099-09-08T08:05:00.000Z",
    budget: { maxPrimitives: 1, maxBlockChanges: 0 },
    skill: "movement.step",
    arguments: { direction: "N" },
  });
}

test("fake Rednet covers registration, command delivery, result, and stop control", () => {
  const bus = new FakeRednet();
  const registration = {
    protocolVersion: 1,
    type: "worker.register",
    workerId,
    workerBootId: "worker-boot-1",
    computerId: turtleId,
    runtimeVersion: "0.1.0",
    capabilities: ["movement.step"],
  };

  WorkerRegistrationSchema.parse({
    workerId: registration.workerId,
    computerId: registration.computerId,
    runtimeVersion: registration.runtimeVersion,
    capabilities: registration.capabilities,
  });
  bus.send(turtleId, gatewayId, protocol, registration);
  const registrationFrame = bus.receive(gatewayId, protocol) as {
    senderId: number;
    message: typeof registration;
  };
  assert.equal(registrationFrame.senderId, turtleId);
  assert.equal(registrationFrame.message.workerId, workerId);

  bus.send(gatewayId, turtleId, protocol, {
    protocolVersion: 1,
    type: "worker.register.ack",
    gatewayId: "gateway-main",
    gatewayBootId,
    workerId,
  });
  const registrationAck = bus.receive(turtleId, protocol) as {
    message: { type: string; gatewayBootId: string };
  };
  assert.equal(registrationAck.message.type, "worker.register.ack");
  assert.equal(registrationAck.message.gatewayBootId, gatewayBootId);

  const command = movementCommand();
  bus.send(gatewayId, turtleId, protocol, {
    protocolVersion: 1,
    type: "worker.command",
    gatewayBootId,
    command,
  });
  const commandFrame = bus.receive(turtleId, protocol) as {
    message: { type: string; command: unknown };
  };
  assert.equal(commandFrame.message.type, "worker.command");
  const deliveredCommand = CommandSchema.parse(commandFrame.message.command);
  assert.equal(deliveredCommand.commandId, command.commandId);

  const completedEvent = EventSchema.parse({
    protocolVersion: 1,
    eventId: "event-completed-1",
    gatewayId: "gateway-main",
    workerId,
    commandId: command.commandId,
    sequence: 1,
    type: "command.completed",
    occurredAt: "2026-09-08T08:00:01.000Z",
    payload: { result: { status: "OK" } },
  });
  bus.send(turtleId, gatewayId, protocol, {
    protocolVersion: 1,
    type: "worker.event",
    gatewayBootId,
    event: completedEvent,
  });
  const eventFrame = bus.receive(gatewayId, protocol) as {
    senderId: number;
    message: { event: unknown };
  };
  assert.equal(eventFrame.senderId, turtleId);
  const eventBatch = EventBatchSchema.parse({
    protocolVersion: 1,
    gatewayId: "gateway-main",
    bootId: gatewayBootId,
    batchId: "batch-1",
    events: [eventFrame.message.event],
  });
  assert.equal(eventBatch.events[0]?.type, "command.completed");

  const stop = StopControlSchema.parse({
    protocolVersion: 1,
    controlId: "stop-1",
    issuedAt: "2026-09-08T08:00:02.000Z",
    type: "worker.stop",
    workerId,
    reason: "operator stop",
  });
  bus.send(gatewayId, turtleId, protocol, {
    protocolVersion: 1,
    type: "worker.stop",
    gatewayBootId,
    control: stop,
  });
  const stopFrame = bus.receive(turtleId, protocol) as {
    message: { gatewayBootId: string; control: unknown };
  };
  assert.equal(stopFrame.message.gatewayBootId, gatewayBootId);
  assert.equal(StopControlSchema.parse(stopFrame.message.control).controlId, "stop-1");
});

test("fake Rednet keeps protocol messages scoped to the requested channel", () => {
  const bus = new FakeRednet();
  bus.send(turtleId, gatewayId, "other-protocol", { protocolVersion: 1 });
  assert.equal(bus.receive(gatewayId, protocol), undefined);
  assert.ok(bus.receive(gatewayId, "other-protocol"));
});
