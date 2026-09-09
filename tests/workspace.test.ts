import assert from "node:assert/strict";
import test from "node:test";

import { protocolVersion } from "../packages/protocol/src/index";
import {
  advanceGatherTask,
  parseAddressedGatherGoal,
  type GatherTaskState,
} from "../packages/domain/src/index";
import {
  findKnownPath,
  NamedLocationRegistry,
  SparseWorldModel,
  type Coordinate,
} from "../packages/navigation/src/index";
import { selectDispatchableTasks, selectReadyTasks } from "../packages/scheduler/src/index";
import {
  assemblePlanningContext,
  CodexCliProvider,
  FakeReasoningProvider,
  PlannerDecisionSchema,
  ReasoningConcurrencyLimiter,
} from "../packages/reasoning/src/index";

test("workspace exposes protocol version one", () => {
  assert.equal(protocolVersion, 1);
});

test("planning context assembler bounds sections and labels observations as untrusted", () => {
  const context = assemblePlanningContext(
    {
      goalText: "get resources",
      project: { id: "project-1" },
      job: { id: "job-1" },
      task: { id: "task-1" },
      worker: { id: "alice" },
      skills: ["mining.gather", "inventory.deposit"],
      worldKnowledge: [{ block: "stone" }, { block: "dirt" }],
      memories: [{ text: "anchor" }],
      recentConversation: [{ speaker: "user", text: "continue" }],
    },
    { maxItemsPerSection: 1, maxPromptCharacters: 512 },
  );
  assert.deepEqual(context.counts, {
    skills: 1,
    worldKnowledge: 1,
    memories: 1,
    recentConversation: 1,
  });
  assert.match(context.prompt, /untrusted data/);
  assert.match(context.prompt, /mining\.gather/);
  assert.doesNotThrow(() =>
    assemblePlanningContext(
      {
        goalText: "x",
        skills: [],
        worldKnowledge: [],
        memories: [],
        recentConversation: [],
      },
      { maxPromptCharacters: 256 },
    ),
  );
});

test("addressed gather goal parser produces a bounded structured goal", () => {
  assert.deepEqual(
    parseAddressedGatherGoal("@alice get 64 cobblestone and deposit it in Test Chest"),
    {
      ok: true,
      goal: {
        targetWorkerId: "alice",
        itemKey: "minecraft:cobblestone",
        quantity: 64,
        destination: "Test Chest",
      },
    },
  );
});

test("addressed gather goal parser rejects unsupported or unsafe quantities", () => {
  assert.equal(
    parseAddressedGatherGoal("get 64 cobblestone and deposit it in Test Chest").ok,
    false,
  );
  assert.equal(
    parseAddressedGatherGoal("@alice get 65 cobblestone and deposit it in Test Chest").ok,
    false,
  );
});

test("gather task state machine advances through bounded delivery phases", () => {
  const state: GatherTaskState = {
    phase: "CHECK_INVENTORY",
    goal: {
      targetWorkerId: "alice",
      itemKey: "minecraft:cobblestone",
      quantity: 8,
      destination: "Test Chest",
    },
    maxDepth: 12,
    collectedQuantity: 0,
    depositedQuantity: 0,
  };

  const gather = advanceGatherTask(state, {
    inventoryQuantity: 0,
    destinationKnown: true,
    atDestination: false,
  });
  assert.equal(gather.state.phase, "GATHER");
  assert.deepEqual(gather.action, {
    kind: "gather",
    itemKey: "minecraft:cobblestone",
    quantity: 8,
    maxDepth: 12,
  });

  const navigate = advanceGatherTask(gather.state, {
    inventoryQuantity: 8,
    destinationKnown: true,
    atDestination: false,
    lastAction: { kind: "gather", status: "OK", collectedQuantity: 8 },
  });
  assert.equal(navigate.state.phase, "NAVIGATE_DESTINATION");
  assert.deepEqual(navigate.action, { kind: "navigate", destination: "Test Chest" });

  const deposit = advanceGatherTask(navigate.state, {
    inventoryQuantity: 8,
    destinationKnown: true,
    atDestination: true,
    lastAction: { kind: "navigate", status: "OK" },
  });
  assert.equal(deposit.state.phase, "DEPOSIT");
  assert.equal(deposit.action?.kind, "deposit");

  const verify = advanceGatherTask(deposit.state, {
    inventoryQuantity: 0,
    destinationKnown: true,
    atDestination: true,
    lastAction: { kind: "deposit", status: "OK", depositedQuantity: 8 },
  });
  assert.equal(verify.state.phase, "VERIFY");
  assert.equal(verify.action?.kind, "verify");

  const completed = advanceGatherTask(verify.state, {
    inventoryQuantity: 0,
    destinationKnown: true,
    atDestination: true,
    lastAction: { kind: "verify", status: "OK", depositedQuantity: 8 },
  });
  assert.equal(completed.state.phase, "COMPLETED");
});

test("gather task state machine blocks safely on an exhausted depth bound", () => {
  const state: GatherTaskState = {
    phase: "GATHER",
    goal: {
      targetWorkerId: "alice",
      itemKey: "minecraft:cobblestone",
      quantity: 8,
      destination: "Test Chest",
    },
    maxDepth: 4,
    collectedQuantity: 2,
    depositedQuantity: 0,
  };
  const result = advanceGatherTask(state, {
    inventoryQuantity: 2,
    destinationKnown: true,
    atDestination: false,
    lastAction: { kind: "gather", status: "TARGET_NOT_REACHED", collectedQuantity: 2 },
  });
  assert.equal(result.state.phase, "BLOCKED");
  assert.match(result.state.blockedReason ?? "", /depth bound/);
  assert.equal(result.action, undefined);
});

test("scheduler baseline selects ready tasks by priority", () => {
  const tasks = selectReadyTasks([
    { taskId: "low", state: "READY", priority: 1 },
    { taskId: "blocked", state: "BLOCKED", priority: 99 },
    { taskId: "high", state: "READY", priority: 5 },
  ]);

  assert.deepEqual(
    tasks.map((task) => task.taskId),
    ["high", "low"],
  );
});

test("scheduler assigns compatible ready tasks without double-booking a worker", () => {
  const assignments = selectDispatchableTasks(
    [
      { taskId: "low", state: "READY", priority: 1, requiredCapabilities: ["move"] },
      { taskId: "high", state: "READY", priority: 5, requiredCapabilities: ["move"] },
      { taskId: "inspect", state: "READY", priority: 4, requiredCapabilities: ["inspect"] },
    ],
    [
      { workerId: "alice", online: true, capabilities: ["move"] },
      { workerId: "bob", online: true, capabilities: ["inspect"] },
    ],
  );

  assert.deepEqual(assignments, [
    { taskId: "high", workerId: "alice" },
    { taskId: "inspect", workerId: "bob" },
  ]);
});

function cell(coordinate: Coordinate, walkable = true) {
  return {
    ...coordinate,
    walkable,
    observedAt: "2026-09-09T00:00:00.000Z",
    source: "test",
  } as const;
}

test("known-world navigation finds a deterministic path around a blocked cell", () => {
  const world = new SparseWorldModel();
  for (let x = 0; x <= 2; x += 1) {
    for (let z = 0; z <= 2; z += 1) {
      world.setCell(cell({ dimension: 0, x, y: 0, z }, x !== 1 || z !== 0));
    }
  }

  const result = findKnownPath(
    world,
    { dimension: 0, x: 0, y: 0, z: 0 },
    { dimension: 0, x: 2, y: 0, z: 0 },
  );

  assert.deepEqual(result?.directions, ["S", "E", "E", "N"]);
  assert.equal(result?.coordinates.at(-1)?.x, 2);
  assert.equal(result?.coordinates.at(-1)?.z, 0);
});

test("known-world navigation does not enter unknown cells or exceed its node budget", () => {
  const world = new SparseWorldModel();
  world.setCell(cell({ dimension: 0, x: 0, y: 0, z: 0 }));
  world.setCell(cell({ dimension: 0, x: 1, y: 0, z: 0 }));

  assert.equal(
    findKnownPath(world, { dimension: 0, x: 0, y: 0, z: 0 }, { dimension: 0, x: 2, y: 0, z: 0 }),
    undefined,
  );
  assert.equal(
    findKnownPath(
      world,
      { dimension: 0, x: 0, y: 0, z: 0 },
      { dimension: 0, x: 1, y: 0, z: 0 },
      { maxNodes: 1 },
    ),
    undefined,
  );
});

test("named locations resolve case-insensitively and retain the latest anchor", () => {
  const locations = new NamedLocationRegistry();
  locations.upsert({
    name: " Test Chest ",
    coordinate: { dimension: 0, x: 4, y: 64, z: -2 },
    facing: "E",
    confidence: "CONFIRMED_ANCHOR",
    source: "operator",
    observedAt: "2026-09-09T00:00:00.000Z",
  });
  locations.upsert({
    name: "test chest",
    coordinate: { dimension: 0, x: 5, y: 64, z: -2 },
    facing: "E",
    confidence: "CONFIRMED_ANCHOR",
    source: "operator-correction",
    observedAt: "2026-09-09T00:01:00.000Z",
  });

  assert.equal(locations.resolve("TEST CHEST")?.coordinate.x, 5);
  assert.deepEqual(
    locations.list().map((location) => location.name),
    ["test chest"],
  );
});

test("planner decisions are structured and fake reasoning is deterministic", async () => {
  const decision = PlannerDecisionSchema.parse({
    kind: "create-task",
    task: {
      skillName: "mining.gather",
      arguments: { itemKey: "minecraft:cobblestone", quantity: 8 },
      requiredCapabilities: ["mining.gather"],
      priority: 2,
    },
  });
  const provider = new FakeReasoningProvider([decision]);
  const result = await provider.decide({
    requestId: "reasoning-test-1",
    prompt: "create a bounded gather task",
    tier: "fast",
    timeoutMs: 1000,
  });
  assert.equal(result.provider, "fake");
  assert.equal(result.decision.kind, "create-task");
  assert.equal(provider.requests[0]?.requestId, "reasoning-test-1");
  assert.equal(
    PlannerDecisionSchema.safeParse({ kind: "delegate", taskId: "task-1", reason: "no target" })
      .success,
    false,
  );
});

test("Codex CLI provider validates structured output without executing it", async () => {
  let executionInput: { args: readonly string[]; prompt: string; timeoutMs: number } | undefined;
  const provider = new CodexCliProvider({
    executable: "codex-test-double",
    execute: async (input) => {
      executionInput = input;
      return JSON.stringify({
        kind: "report",
        status: "PROGRESS",
        summary: "bounded plan accepted",
      });
    },
  });
  const result = await provider.decide({
    requestId: "reasoning-cli-test-1",
    prompt: "produce a bounded plan",
    tier: "standard",
    timeoutMs: 1000,
  });
  assert.equal(result.provider, "codex-cli");
  assert.equal(result.decision.kind, "report");
  assert.deepEqual(executionInput?.args, []);
  assert.match(executionInput?.prompt ?? "", /Return exactly one JSON object/);
  assert.equal(executionInput?.timeoutMs, 1000);

  const invalidProvider = new CodexCliProvider({
    execute: async () => JSON.stringify({ kind: "unknown" }),
  });
  await assert.rejects(
    invalidProvider.decide({
      requestId: "reasoning-cli-test-2",
      prompt: "invalid",
      tier: "fast",
      timeoutMs: 1000,
    }),
  );
});

test("reasoning concurrency limiter bounds active calls and cancels queued work", async () => {
  let active = 0;
  let maximumActive = 0;
  const provider = new ReasoningConcurrencyLimiter(
    {
      decide: async (request) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return {
          requestId: request.requestId,
          provider: "test",
          decision: { kind: "report", status: "PROGRESS", summary: "ok" },
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      },
    },
    2,
  );
  await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      provider.decide({
        requestId: `limit-${index}`,
        prompt: "test",
        tier: "fast",
        timeoutMs: 1000,
      }),
    ),
  );
  assert.equal(maximumActive, 2);

  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blockingProvider = new ReasoningConcurrencyLimiter(
    {
      decide: async (request) => {
        await started;
        return {
          requestId: request.requestId,
          provider: "test",
          decision: { kind: "report", status: "PROGRESS", summary: "ok" },
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      },
    },
    1,
  );
  const first = blockingProvider.decide({
    requestId: "blocking-1",
    prompt: "test",
    tier: "fast",
    timeoutMs: 1000,
  });
  const controller = new AbortController();
  const second = blockingProvider.decide({
    requestId: "blocking-2",
    prompt: "test",
    tier: "fast",
    timeoutMs: 1000,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(second, /cancelled/);
  release();
  await first;
});
