import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type {
  Command,
  EventBatch,
  GatewayHeartbeat,
  GatewayRegistration,
  StopControl,
} from "@computercraft-agents/protocol";

import {
  GatewayService,
  type GatewayServiceStore,
} from "../apps/control-plane/src/gateway-service";
import { createControlPlaneServer } from "../apps/control-plane/src/http";

const gatewayId = "gateway-test";
const bootId = "boot-test";
const secret = "test-secret";

function command(): Command {
  return {
    protocolVersion: 1,
    commandId: "command-test",
    workerId: "worker-test",
    issuedAt: "2026-09-07T12:00:00.000Z",
    expiresAt: "2026-09-07T12:05:00.000Z",
    budget: { maxPrimitives: 1, maxBlockChanges: 0 },
    skill: "movement.step",
    arguments: { direction: "N" },
  };
}

class FakeGatewayStore implements GatewayServiceStore {
  public readonly registrations: GatewayRegistration[] = [];
  public readonly heartbeats: GatewayHeartbeat[] = [];
  public readonly eventBatches: EventBatch[] = [];
  public readonly commands: Command[] = [];
  public readonly stopControls: StopControl[] = [];

  public async register(payload: GatewayRegistration): Promise<void> {
    this.registrations.push(payload);
  }

  public async heartbeat(payload: GatewayHeartbeat): Promise<void> {
    this.heartbeats.push(payload);
  }

  public async poll(): Promise<{
    commands: readonly Command[];
    stopControls: readonly StopControl[];
    nextCursor: string;
  }> {
    return {
      commands: [command()],
      stopControls: [
        {
          protocolVersion: 1,
          controlId: "stop-test",
          issuedAt: "2026-09-07T12:00:00.000Z",
          type: "worker.stop",
          workerId: "worker-test",
        },
      ],
      nextCursor: "1",
    };
  }

  public async ingestEvents(payload: EventBatch): Promise<string[]> {
    this.eventBatches.push(payload);
    return payload.events.map((event) => event.eventId);
  }

  public async enqueueCommand(payload: Command): Promise<void> {
    this.commands.push(payload);
  }

  public async enqueueStopControl(payload: StopControl): Promise<void> {
    this.stopControls.push(payload);
  }

  public async listWorkers(): Promise<readonly Record<string, unknown>[]> {
    return [];
  }

  public async listGateways(): Promise<readonly Record<string, unknown>[]> {
    return [];
  }
}

async function startServer(
  store: FakeGatewayStore,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createControlPlaneServer({
    service: new GatewayService(store, { bearerSecret: secret, adminSecret: "admin-secret" }),
    maxBodyBytes: 100_000,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

function gatewayHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
    "X-Agent-Gateway-Id": gatewayId,
  };
}

function adminHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Control-Plane-Secret": "admin-secret",
  };
}

test("control-plane gateway API authenticates and validates gateway identity", async () => {
  const store = new FakeGatewayStore();
  const server = await startServer(store);
  try {
    const unauthorized = await fetch(`${server.baseUrl}/v1/gateway/commands`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${server.baseUrl}/v1/gateway/register`, {
      method: "POST",
      headers: gatewayHeaders(),
      body: JSON.stringify({
        protocolVersion: 1,
        gatewayId,
        bootId,
        minecraftServerId: "minecraft-test",
        workers: [],
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(store.registrations[0]?.gatewayId, gatewayId);
  } finally {
    await server.close();
  }
});

test("control-plane gateway API returns commands/stops and acknowledges events", async () => {
  const store = new FakeGatewayStore();
  const server = await startServer(store);
  try {
    const poll = await fetch(`${server.baseUrl}/v1/gateway/commands`, {
      headers: gatewayHeaders(),
    });
    assert.equal(poll.status, 200);
    const pollBody = (await poll.json()) as { commands: Command[]; stopControls: StopControl[] };
    assert.equal(pollBody.commands[0]?.commandId, "command-test");
    assert.equal(pollBody.stopControls[0]?.type, "worker.stop");

    const events = await fetch(`${server.baseUrl}/v1/gateway/events`, {
      method: "POST",
      headers: gatewayHeaders(),
      body: JSON.stringify({
        protocolVersion: 1,
        gatewayId,
        bootId,
        batchId: "batch-test",
        events: [
          {
            protocolVersion: 1,
            eventId: "event-test",
            gatewayId,
            workerId: "worker-test",
            commandId: "command-test",
            sequence: 1,
            type: "command.completed",
            occurredAt: "2026-09-07T12:01:00.000Z",
            payload: { result: { ok: true } },
          },
        ],
      }),
    });
    assert.equal(events.status, 200);
    const eventBody = (await events.json()) as { acceptedEventIds: string[] };
    assert.deepEqual(eventBody.acceptedEventIds, ["event-test"]);
    assert.equal(store.eventBatches.length, 1);
  } finally {
    await server.close();
  }
});

test("operator API supports inspection and deterministic command/stop enqueueing", async () => {
  const store = new FakeGatewayStore();
  const server = await startServer(store);
  try {
    const diagnostics = await fetch(`${server.baseUrl}/v1/diagnostics`, {
      headers: adminHeaders(),
    });
    assert.equal(diagnostics.status, 200);

    const enqueue = await fetch(`${server.baseUrl}/v1/commands`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(command()),
    });
    assert.equal(enqueue.status, 200);
    assert.equal(store.commands[0]?.commandId, "command-test");

    const stop = await fetch(`${server.baseUrl}/v1/stop-controls`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        protocolVersion: 1,
        controlId: "stop-admin-test",
        issuedAt: "2026-09-07T12:00:00.000Z",
        type: "all.stop",
      }),
    });
    assert.equal(stop.status, 200);
    assert.equal(store.stopControls[0]?.controlId, "stop-admin-test");
  } finally {
    await server.close();
  }
});
