import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type {
  Command,
  DirectWorkerEventBatch,
  DirectWorkerHeartbeat,
  DirectWorkerProvision,
  DirectWorkerRegistration,
  EventBatch,
  GatewayHeartbeat,
  GatewayRegistration,
  StopControl,
  UpdateRequest,
} from "@computercraft-agents/protocol";

import {
  GatewayService,
  type GatewayServiceStore,
} from "../apps/control-plane/src/gateway-service";
import type {
  DirectWorkerPollResult,
  GatewayPollResult,
  UpdateRolloutRecord,
} from "@computercraft-agents/database";
import { createControlPlaneServer } from "../apps/control-plane/src/http";

const gatewayId = "gateway-test";
const bootId = "boot-test";
const secret = "test-secret";

async function responseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

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
  public readonly updates: UpdateRolloutRecord[] = [];
  public readonly directRegistrations: DirectWorkerRegistration[] = [];
  public readonly directHeartbeats: DirectWorkerHeartbeat[] = [];
  public readonly directEvents: DirectWorkerEventBatch[] = [];
  public readonly runnableTasks: Record<string, unknown>[] = [
    { taskId: "task-runnable", status: "READY" },
  ];
  public readonly availableWorkers: Record<string, unknown>[] = [];
  public readonly worldCells: Record<string, unknown>[] = [];
  public readonly tasks: Record<string, unknown>[] = [];

  public async register(payload: GatewayRegistration): Promise<void> {
    this.registrations.push(payload);
  }

  public async heartbeat(payload: GatewayHeartbeat): Promise<void> {
    this.heartbeats.push(payload);
  }

  public async poll(): Promise<GatewayPollResult> {
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
      updates: [],
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

  public async enqueueUpdate(payload: UpdateRequest): Promise<UpdateRolloutRecord> {
    const record: UpdateRolloutRecord = {
      ...payload,
      status: "QUEUED",
      gatewayId,
      workerIds: payload.target.startsWith("worker:")
        ? [payload.target.slice("worker:".length)]
        : [],
      transport: "gateway-rednet",
    };
    this.updates.push(record);
    return record;
  }

  public async listUpdates(): Promise<readonly UpdateRolloutRecord[]> {
    return this.updates;
  }

  public async getUpdate(updateId: string): Promise<UpdateRolloutRecord | undefined> {
    return this.updates.find((update) => update.updateId === updateId);
  }

  public async listWorkers(): Promise<readonly Record<string, unknown>[]> {
    return this.availableWorkers;
  }

  public async getWorker(workerId: string): Promise<Record<string, unknown> | undefined> {
    if (workerId === "path-worker") {
      return {
        workerId,
        computerId: 8,
        online: true,
        observation: {
          position: { dimension: 0, x: 0, y: 0, z: 0, confidence: "CONFIRMED" },
        },
      };
    }
    return workerId === "worker-test"
      ? { workerId, computerId: 7, online: true, observation: null }
      : undefined;
  }

  public async listGateways(): Promise<readonly Record<string, unknown>[]> {
    return [];
  }

  public async provisionDirectWorker(
    payload: DirectWorkerProvision,
  ): Promise<Record<string, unknown>> {
    return {
      workerId: payload.workerId,
      computerId: payload.computerId,
      transport: payload.transport,
      minecraftServerId: payload.minecraftServerId,
    };
  }

  public async registerDirectWorker(payload: DirectWorkerRegistration): Promise<{
    readonly workerId: string;
    readonly workerBootId: string;
  }> {
    this.directRegistrations.push(payload);
    return { workerId: payload.workerId, workerBootId: payload.workerBootId };
  }

  public async heartbeatDirectWorker(payload: DirectWorkerHeartbeat): Promise<{
    readonly workerId: string;
    readonly workerBootId: string;
  }> {
    this.directHeartbeats.push(payload);
    return { workerId: payload.workerId, workerBootId: payload.workerBootId };
  }

  public async pollDirectWorker(): Promise<DirectWorkerPollResult> {
    return {
      commands: [command()],
      stopControls: [],
      updates: [],
      nextCursor: "1",
    };
  }

  public async ingestDirectWorkerEvents(payload: DirectWorkerEventBatch): Promise<string[]> {
    this.directEvents.push(payload);
    return payload.events.map((event) => event.eventId);
  }

  public async createGoal(input: {
    readonly projectName: string;
    readonly createdByPrincipal: string;
    readonly goalText: string;
    readonly priority: number;
    readonly skillName: string;
    readonly arguments: unknown;
    readonly requiredCapabilities?: readonly string[];
  }) {
    return {
      projectId: "project-test",
      jobId: "job-test",
      taskId: "task-test",
      goalText: input.goalText,
      status: "READY",
      skillName: input.skillName,
      arguments: input.arguments,
      requiredCapabilities: input.requiredCapabilities,
    };
  }

  public async listGoals(): Promise<readonly Record<string, unknown>[]> {
    return [];
  }

  public async listTasks(): Promise<readonly Record<string, unknown>[]> {
    return this.tasks;
  }

  public async getTask(taskId: string): Promise<Record<string, unknown> | undefined> {
    return this.tasks.find((task) => task.taskId === taskId);
  }

  public async listRunnableTasks(): Promise<readonly Record<string, unknown>[]> {
    return this.runnableTasks;
  }

  public async claimTask(taskId: string, workerKey: string): Promise<Record<string, unknown>> {
    return { taskId, workerKey, status: "RUNNING" };
  }

  public async dispatchTask(
    taskId: string,
    workerKey: string,
    commandId: string,
  ): Promise<Command> {
    return { ...command(), taskId, workerId: workerKey, commandId };
  }

  public async transitionTask(taskId: string, nextState: string, reason?: string): Promise<void> {
    this.transitionedTask = { taskId, nextState, reason };
  }

  public transitionedTask: { taskId: string; nextState: string; reason?: string } | undefined;

  public async upsertNamedLocation(input: {
    readonly name: string;
    readonly dimension: number;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly facing?: string | null;
    readonly source: string;
    readonly confidence: string;
    readonly metadata: unknown;
  }): Promise<Record<string, unknown>> {
    return { locationId: "location-test", ...input };
  }

  public async listNamedLocations(): Promise<readonly Record<string, unknown>[]> {
    return [];
  }

  public async resolveNamedLocation(name: string): Promise<Record<string, unknown> | undefined> {
    return name.trim().toLocaleLowerCase() === "test chest"
      ? {
          locationId: "location-test",
          name: "Test Chest",
          dimension: 0,
          x: 1,
          y: 2,
          z: 3,
          confidence: "CONFIRMED_ANCHOR",
        }
      : undefined;
  }

  public async listWorldCells(): Promise<readonly Record<string, unknown>[]> {
    return this.worldCells;
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

    const authenticatedConnectivity = await fetch(
      `${server.baseUrl}/v1/gateway/authenticated-connectivity`,
      { headers: gatewayHeaders() },
    );
    assert.equal(authenticatedConnectivity.status, 204);
  } finally {
    await server.close();
  }
});

test("operator goal API creates a validated gather task", async () => {
  const store = new FakeGatewayStore();
  const server = await startServer(store);
  try {
    const response = await fetch(`${server.baseUrl}/v1/goals`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        protocolVersion: 1,
        goalText: "@alice get 64 cobblestone and deposit it in Test Chest",
        createdByPrincipal: "test-operator",
      }),
    });
    assert.equal(response.status, 202);
    const body = (await response.json()) as { status: string; skillName: string };
    assert.equal(body.status, "READY");
    assert.equal(body.skillName, "resource.gather");
  } finally {
    await server.close();
  }
});

test("operator task API lists and claims tasks", async () => {
  const store = new FakeGatewayStore();
  const server = await startServer(store);
  try {
    const list = await fetch(`${server.baseUrl}/v1/tasks`, { headers: adminHeaders() });
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json()) as { tasks: unknown[] }, { tasks: [] });

    const claim = await fetch(`${server.baseUrl}/v1/tasks/task-test`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ workerId: "alice" }),
    });
    assert.equal(claim.status, 200);
    assert.deepEqual((await claim.json()) as Record<string, unknown>, {
      taskId: "task-test",
      workerKey: "alice",
      status: "RUNNING",
    });
  } finally {
    await server.close();
  }
});

test("operator task API returns one task by ID", async () => {
  const store = new FakeGatewayStore();
  store.tasks.push({ taskId: "task-detail", status: "BLOCKED", lastError: { reason: "no path" } });
  const server = await startServer(store);
  try {
    const response = await fetch(`${server.baseUrl}/v1/tasks/task-detail`, {
      headers: adminHeaders(),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      taskId: "task-detail",
      status: "BLOCKED",
      lastError: { reason: "no path" },
    });
  } finally {
    await server.close();
  }
});

test("operator planning-context API assembles bounded persisted records", async () => {
  const store = new FakeGatewayStore();
  store.tasks.push({
    taskId: "task-context",
    skillName: "movement.step",
    goalText: "move Alice safely",
    arguments: { targetWorkerId: "worker-test" },
    requiredCapabilities: ["movement.step"],
  });
  const server = await startServer(store);
  try {
    const response = await fetch(`${server.baseUrl}/v1/tasks/task-context/planning-context`, {
      headers: adminHeaders(),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      taskId: string;
      workerId: string;
      prompt: string;
      counts: { skills: number; worldKnowledge: number };
    };
    assert.equal(body.taskId, "task-context");
    assert.equal(body.workerId, "worker-test");
    assert.match(body.prompt, /untrusted data/);
    assert.equal(body.counts.skills, 1);
    assert.equal(body.counts.worldKnowledge, 0);
  } finally {
    await server.close();
  }
});

test("operator task API validates and applies explicit task transitions", async () => {
  const store = new FakeGatewayStore();
  const server = await startServer(store);
  try {
    const response = await fetch(`${server.baseUrl}/v1/tasks/task-test/transition`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        protocolVersion: 1,
        status: "BLOCKED",
        reason: "awaiting destination anchor",
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      accepted: true,
      taskId: "task-test",
      status: "BLOCKED",
      reason: "awaiting destination anchor",
    });
    assert.deepEqual(store.transitionedTask, {
      taskId: "task-test",
      nextState: "BLOCKED",
      reason: "awaiting destination anchor",
    });
  } finally {
    await server.close();
  }
});

test("operator task API dispatches a task as a correlated worker command", async () => {
  const store = new FakeGatewayStore();
  const server = await startServer(store);
  try {
    const response = await fetch(`${server.baseUrl}/v1/tasks/task-test/dispatch`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ protocolVersion: 1, workerId: "alice" }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      accepted: boolean;
      taskId: string;
      workerId: string;
      command: Command;
    };
    assert.equal(body.accepted, true);
    assert.equal(body.taskId, "task-test");
    assert.equal(body.workerId, "alice");
    assert.equal(body.command.taskId, "task-test");
    assert.equal(body.command.workerId, "alice");
  } finally {
    await server.close();
  }
});

test("operator scheduler tick dispatches only protocol-level runnable work", async () => {
  const store = new FakeGatewayStore();
  store.runnableTasks.splice(0, 1, {
    taskId: "task-runnable",
    skillName: "movement.step",
    priority: 5,
    requiredCapabilities: ["movement.step"],
  });
  store.availableWorkers.push({
    workerId: "alice",
    online: true,
    capabilities: ["movement.step"],
  });
  const server = await startServer(store);
  try {
    const response = await fetch(`${server.baseUrl}/v1/scheduler/tick`, {
      method: "POST",
      headers: adminHeaders(),
      body: "{}",
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      dispatched: Array<Record<string, unknown>>;
    };
    assert.equal(body.dispatched.length, 1);
    assert.deepEqual(body.dispatched[0], {
      taskId: "task-runnable",
      workerId: "alice",
      status: "DISPATCHED",
      commandId: body.dispatched[0]?.commandId,
    });
    assert.match(String(body.dispatched[0]?.commandId), /^scheduler-[0-9a-f-]+$/);
  } finally {
    await server.close();
  }
});

test("operator task API exposes dependency-filtered runnable tasks", async () => {
  const store = new FakeGatewayStore();
  const server = await startServer(store);
  try {
    const response = await fetch(`${server.baseUrl}/v1/tasks/runnable`, {
      headers: adminHeaders(),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      tasks: [{ taskId: "task-runnable", status: "READY" }],
    });
  } finally {
    await server.close();
  }
});

test("operator location API upserts a named anchor", async () => {
  const store = new FakeGatewayStore();
  const server = await startServer(store);
  try {
    const response = await fetch(`${server.baseUrl}/v1/locations`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        protocolVersion: 1,
        name: "Test Chest",
        dimension: 0,
        x: 5,
        y: 64,
        z: -2,
        facing: "E",
        source: "operator",
        confidence: "CONFIRMED_ANCHOR",
      }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { name: string; confidence: string };
    assert.equal(body.name, "Test Chest");
    assert.equal(body.confidence, "CONFIRMED_ANCHOR");
  } finally {
    await server.close();
  }
});

test("operator location API resolves names case-insensitively", async () => {
  const store = new FakeGatewayStore();
  const server = await startServer(store);
  try {
    const response = await fetch(
      `${server.baseUrl}/v1/locations/${encodeURIComponent("test chest")}`,
      { headers: adminHeaders() },
    );
    const responseBody = await response.text();
    assert.equal(response.status, 200);
    const body = JSON.parse(responseBody) as { name: string; x: number; y: number; z: number };
    assert.equal(body.name, "Test Chest");
    assert.deepEqual([body.x, body.y, body.z], [1, 2, 3]);
  } finally {
    await server.close();
  }
});

test("operator path API plans only through known walkable cells", async () => {
  const store = new FakeGatewayStore();
  for (const [x, y, z] of [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [1, 2, 0],
    [1, 2, 1],
    [1, 2, 2],
    [1, 2, 3],
  ]) {
    store.worldCells.push({
      dimension: 0,
      x,
      y,
      z,
      walkable: true,
      observedAt: "2026-09-09T00:00:00.000Z",
      sourceWorkerId: "path-worker",
    });
  }
  const server = await startServer(store);
  try {
    const response = await fetch(
      `${server.baseUrl}/v1/workers/path-worker/path-to/${encodeURIComponent("Test Chest")}`,
      { headers: adminHeaders() },
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { directions: string[]; expandedNodes: number };
    assert.deepEqual(body.directions, ["E", "UP", "UP", "S", "S", "S"]);
    assert.ok(body.expandedNodes > 0);
  } finally {
    await server.close();
  }
});

test("operator world-cell API is bounded and read-only", async () => {
  const store = new FakeGatewayStore();
  const server = await startServer(store);
  try {
    const response = await fetch(`${server.baseUrl}/v1/world/cells`, {
      headers: adminHeaders(),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()) as { cells: unknown[] }, { cells: [] });
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
    const pollBody = (await poll.json()) as {
      commands: Command[];
      stopControls: StopControl[];
      updates: unknown[];
    };
    assert.equal(pollBody.commands[0]?.commandId, "command-test");
    assert.equal(pollBody.stopControls[0]?.type, "worker.stop");
    assert.deepEqual(pollBody.updates, []);

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

    const provision = await fetch(`${server.baseUrl}/v1/workers/provision`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        protocolVersion: 1,
        transport: "direct-http",
        workerId: "alice-direct",
        minecraftServerId: "friends-server",
        computerId: 21,
        runtimeVersion: "v0.4.0",
        capabilities: [],
      }),
    });
    assert.equal(provision.status, 200);
    assert.equal((await responseJson<{ transport: string }>(provision)).transport, "direct-http");

    const worker = await fetch(`${server.baseUrl}/v1/workers/worker-test`, {
      headers: adminHeaders(),
    });
    assert.equal(worker.status, 200);
    assert.equal((await responseJson<{ workerId: string }>(worker)).workerId, "worker-test");

    const missingWorker = await fetch(`${server.baseUrl}/v1/workers/missing`, {
      headers: adminHeaders(),
    });
    assert.equal(missingWorker.status, 404);

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

    const update = await fetch(`${server.baseUrl}/v1/updates`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        protocolVersion: 1,
        updateId: "update-admin-test",
        target: "worker:worker-test",
        releaseVersion: "v0.2.0",
        manifestUrl:
          "https://github.com/1112zakaria/computercraft-agents/releases/download/v0.2.0/release-manifest.json",
        issuedAt: "2026-09-08T12:00:00.000Z",
        expiresAt: "2026-09-08T12:30:00.000Z",
      }),
    });
    assert.equal(update.status, 202);
    assert.equal((await responseJson<{ updateId: string }>(update)).updateId, "update-admin-test");

    const updateList = await fetch(`${server.baseUrl}/v1/updates`, { headers: adminHeaders() });
    assert.equal(updateList.status, 200);
    assert.equal(
      (await responseJson<{ updates: Array<{ status: string }> }>(updateList)).updates[0]?.status,
      "QUEUED",
    );

    const updateStatus = await fetch(`${server.baseUrl}/v1/updates/update-admin-test`, {
      headers: adminHeaders(),
    });
    assert.equal(updateStatus.status, 200);
  } finally {
    await server.close();
  }
});

test("direct worker API authenticates, polls, and ingests worker events", async () => {
  const store = new FakeGatewayStore();
  const server = await startServer(store);
  const workerId = "alice-direct";
  const workerBootId = "worker-boot-direct";
  const workerHeaders = {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
    "X-Agent-Worker-Id": workerId,
  };
  try {
    const unauthorized = await fetch(`${server.baseUrl}/v1/worker/commands`);
    assert.equal(unauthorized.status, 401);

    const registration = await fetch(`${server.baseUrl}/v1/worker/register`, {
      method: "POST",
      headers: workerHeaders,
      body: JSON.stringify({
        protocolVersion: 1,
        workerId,
        workerBootId,
        minecraftServerId: "friends-server",
        computerId: 21,
        runtimeVersion: "v0.4.0",
        capabilities: ["movement.step"],
      }),
    });
    assert.equal(registration.status, 200);
    assert.equal(store.directRegistrations[0]?.workerId, workerId);

    const heartbeat = await fetch(`${server.baseUrl}/v1/worker/heartbeat`, {
      method: "POST",
      headers: workerHeaders,
      body: JSON.stringify({
        protocolVersion: 1,
        workerId,
        workerBootId,
        minecraftServerId: "friends-server",
        computerId: 21,
        runtimeVersion: "v0.4.0",
        status: "ONLINE",
        executionState: "IDLE",
        capabilities: ["movement.step"],
        lastSeenAt: "2026-09-08T12:00:00.000Z",
        currentCommandId: null,
        position: null,
        fuel: null,
      }),
    });
    assert.equal(heartbeat.status, 200);
    assert.equal(store.directHeartbeats[0]?.workerBootId, workerBootId);

    const poll = await fetch(`${server.baseUrl}/v1/worker/commands?after=0`, {
      headers: workerHeaders,
    });
    assert.equal(poll.status, 200);
    assert.equal(
      (await responseJson<{ commands: Array<{ commandId: string }> }>(poll)).commands[0]?.commandId,
      "command-test",
    );

    const events = await fetch(`${server.baseUrl}/v1/worker/events`, {
      method: "POST",
      headers: workerHeaders,
      body: JSON.stringify({
        protocolVersion: 1,
        workerId,
        workerBootId,
        batchId: "direct-batch-1",
        events: [
          {
            protocolVersion: 1,
            eventId: "direct-event-1",
            workerId,
            commandId: "command-test",
            sequence: 1,
            type: "command.completed",
            occurredAt: "2026-09-08T12:00:01.000Z",
            payload: { result: { ok: true } },
          },
        ],
      }),
    });
    assert.equal(events.status, 200);
    assert.deepEqual(
      (await responseJson<{ acceptedEventIds: string[] }>(events)).acceptedEventIds,
      ["direct-event-1"],
    );
    assert.equal(store.directEvents.length, 1);
  } finally {
    await server.close();
  }
});

test("direct worker API rejects a mismatched worker identity", async () => {
  const store = new FakeGatewayStore();
  const server = await startServer(store);
  try {
    const response = await fetch(`${server.baseUrl}/v1/worker/register`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        "X-Agent-Worker-Id": "alice",
      },
      body: JSON.stringify({
        protocolVersion: 1,
        workerId: "bob",
        workerBootId: "worker-boot",
        minecraftServerId: "friends-server",
        computerId: 21,
        runtimeVersion: "v0.4.0",
        capabilities: [],
      }),
    });
    assert.equal(response.status, 401);
  } finally {
    await server.close();
  }
});
