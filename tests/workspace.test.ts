import assert from "node:assert/strict";
import test from "node:test";

import { protocolVersion } from "../packages/protocol/src/index";
import {
  advanceGatherTask,
  normalizeItemKey,
  parseAddressedGatherGoal,
  parseAddressedCommand,
  resolveAddressedTargets,
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
  PlannerTriggerRunner,
  PlannerTriggerService,
  plannerTriggerFromEvent,
  PlannerDecisionSchema,
  ReasoningConcurrencyLimiter,
  ReasoningOutageStateMachine,
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

test("item keys normalize namespaced and bare values canonically", () => {
  assert.equal(normalizeItemKey(" CobbleStone "), "minecraft:cobblestone");
  assert.equal(normalizeItemKey("Minecraft:CoBbleStone"), "minecraft:cobblestone");
});

test("address parser handles workers, groups, lists, and all without interpretation", () => {
  assert.deepEqual(parseAddressedCommand("@alice get stone"), {
    ok: true,
    command: {
      targets: [{ kind: "named", name: "alice" }],
      commandText: "get stone",
    },
  });
  assert.deepEqual(parseAddressedCommand("@alice,@bob clear this area"), {
    ok: true,
    command: {
      targets: [
        { kind: "named", name: "alice" },
        { kind: "named", name: "bob" },
      ],
      commandText: "clear this area",
    },
  });
  assert.deepEqual(parseAddressedCommand("@miners gather iron"), {
    ok: true,
    command: { targets: [{ kind: "named", name: "miners" }], commandText: "gather iron" },
  });
  assert.deepEqual(parseAddressedCommand("@all return to the workshop"), {
    ok: true,
    command: { targets: [{ kind: "all" }], commandText: "return to the workshop" },
  });
  assert.equal(parseAddressedCommand("@all,@alice stop").ok, false);
  assert.equal(parseAddressedCommand("@alice,@alice stop").ok, false);
});

test("address parser canonicalizes worker names before registry lookup", () => {
  assert.deepEqual(parseAddressedCommand("@ALICE inspect"), {
    ok: true,
    command: {
      targets: [{ kind: "named", name: "alice" }],
      commandText: "inspect",
    },
  });
});

test("address resolution expands workers, groups, and all deterministically", () => {
  const registry = {
    workers: ["alice", "bob", "charlie"],
    groups: { Miners: ["alice", "bob"], builders: ["bob", "missing"] },
  } as const;

  const group = parseAddressedCommand("@MINERS,@charlie inspect");
  assert.equal(group.ok, true);
  if (group.ok) {
    assert.deepEqual(resolveAddressedTargets(group.command, registry), {
      ok: true,
      resolution: {
        workerIds: ["alice", "bob", "charlie"],
        groups: ["Miners"],
        allWorkers: false,
      },
    });
  }

  const all = parseAddressedCommand("@all stop");
  assert.equal(all.ok, true);
  if (all.ok) {
    assert.deepEqual(resolveAddressedTargets(all.command, registry), {
      ok: true,
      resolution: {
        workerIds: ["alice", "bob", "charlie"],
        groups: [],
        allWorkers: true,
      },
    });
  }

  const unknown = parseAddressedCommand("@unknown inspect");
  assert.equal(unknown.ok, true);
  if (unknown.ok) {
    assert.deepEqual(resolveAddressedTargets(unknown.command, registry), {
      ok: false,
      error: "unknown address target: @unknown",
    });
  }
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

test("scheduler honors an explicitly targeted worker", () => {
  const assignments = selectDispatchableTasks(
    [
      {
        taskId: "targeted",
        state: "READY",
        priority: 1,
        requiredCapabilities: ["move"],
        targetWorkerId: "bob",
      },
    ],
    [
      { workerId: "alice", online: true, capabilities: ["move"] },
      { workerId: "bob", online: true, capabilities: ["move"] },
    ],
  );

  assert.deepEqual(assignments, [{ taskId: "targeted", workerId: "bob" }]);
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

test("planner trigger service classifies and deduplicates event-driven requests", async () => {
  const trigger = plannerTriggerFromEvent({
    triggerId: "event-goal-1",
    cause: "goal.created",
    subjectId: "task-1",
    occurredAt: "2026-09-09T00:00:00.000Z",
    priority: 3,
  });
  assert.equal(trigger?.cause, "goal.created");
  assert.equal(
    plannerTriggerFromEvent({
      triggerId: "event-invalid",
      cause: "unknown",
      subjectId: "task-1",
      occurredAt: "2026-09-09T00:00:00.000Z",
    }),
    undefined,
  );

  const provider = new FakeReasoningProvider([
    { kind: "report", status: "PROGRESS", summary: "queued for deterministic execution" },
  ]);
  const service = new PlannerTriggerService({
    provider,
    tier: "fast",
    timeoutMs: 1000,
    assembleContext: async (received) => ({
      goalText: received.subjectId,
      task: { trigger: received.cause },
      skills: [],
      worldKnowledge: [],
      memories: [],
      recentConversation: [],
    }),
  });
  const first = await service.handle(trigger);
  const duplicate = await service.handle(trigger);
  assert.equal(first?.decision.kind, "report");
  assert.equal(duplicate, undefined);
  assert.equal(provider.requests.length, 1);
  assert.match(provider.requests[0]?.prompt ?? "", /goal\.created/);
});

test("planner trigger failures remain retryable behind the outage gate", async () => {
  const trigger = plannerTriggerFromEvent({
    triggerId: "retry-trigger",
    cause: "replan.required",
    subjectId: "task-retry",
    occurredAt: "2026-09-09T00:00:00.000Z",
  });
  assert.ok(trigger);
  let attempts = 0;
  const outage = new ReasoningOutageStateMachine({ failureThreshold: 1, retryAfterMs: 60_000 });
  const service = new PlannerTriggerService({
    provider: {
      async decide(request) {
        attempts += 1;
        if (attempts === 1) throw new Error("provider unavailable");
        return {
          requestId: request.requestId,
          provider: "test",
          decision: { kind: "replan", reason: "retry succeeded" },
          startedAt: "2026-09-09T00:00:00.000Z",
          completedAt: "2026-09-09T00:00:00.000Z",
        };
      },
    },
    outage,
    tier: "fast",
    timeoutMs: 1000,
    assembleContext: async () => ({
      goalText: "retry",
      skills: [],
      worldKnowledge: [],
      memories: [],
      recentConversation: [],
    }),
  });
  await assert.rejects(service.handle(trigger), /provider unavailable/);
  assert.equal(service.pendingRetryCount(), 1);
  assert.deepEqual(await service.retryPending(new Date("2026-09-09T00:00:00.000Z")), []);
  outage.recordSuccess();
  const retry = (await service.retryPending()).at(0);
  assert.equal(retry?.decision.kind, "replan");
  assert.equal(service.pendingRetryCount(), 0);
  assert.equal(attempts, 2);
  assert.equal(await service.handle(trigger), undefined);
});

test("planner trigger runner completes only after the decision sink succeeds", async () => {
  const trigger = plannerTriggerFromEvent({
    triggerId: "runner-trigger",
    cause: "goal.created",
    subjectId: "task-runner",
    occurredAt: "2026-09-09T00:00:00.000Z",
  });
  assert.ok(trigger);
  const provider = new FakeReasoningProvider([
    { kind: "report", status: "PROGRESS", summary: "ready" },
  ]);
  const service = new PlannerTriggerService({
    provider,
    tier: "fast",
    timeoutMs: 1000,
    assembleContext: async () => ({
      goalText: "runner",
      skills: [],
      worldKnowledge: [],
      memories: [],
      recentConversation: [],
    }),
  });
  const completed: string[] = [];
  const released: string[] = [];
  let applied = 0;
  const runner = new PlannerTriggerRunner(
    {
      async claim() {
        return completed.length === 0 ? [trigger] : [];
      },
      async complete(triggerId) {
        completed.push(triggerId);
        return true;
      },
      async release(triggerId) {
        released.push(triggerId);
        return true;
      },
    },
    service,
    {
      async apply(received, result) {
        assert.equal(received.triggerId, trigger.triggerId);
        assert.equal(result.decision.kind, "report");
        applied += 1;
      },
    },
  );

  assert.deepEqual(await runner.runOnce(), {
    claimed: 1,
    succeeded: 1,
    failed: 0,
    released: 0,
  });
  assert.equal(applied, 1);
  assert.deepEqual(completed, [trigger.triggerId]);
  assert.deepEqual(released, []);
});

test("planner trigger runner releases provider failures for retry", async () => {
  const trigger = plannerTriggerFromEvent({
    triggerId: "runner-failure",
    cause: "replan.required",
    subjectId: "task-runner",
    occurredAt: "2026-09-09T00:00:00.000Z",
  });
  assert.ok(trigger);
  const service = new PlannerTriggerService({
    provider: {
      async decide() {
        throw new Error("provider unavailable");
      },
    },
    tier: "fast",
    timeoutMs: 1000,
    assembleContext: async () => ({
      goalText: "runner",
      skills: [],
      worldKnowledge: [],
      memories: [],
      recentConversation: [],
    }),
  });
  let releasedError: unknown;
  const runner = new PlannerTriggerRunner(
    {
      async claim() {
        return [trigger];
      },
      async complete() {
        return false;
      },
      async release(_triggerId, error) {
        releasedError = error;
        return true;
      },
    },
    service,
    { async apply() {} },
  );
  assert.deepEqual(await runner.runOnce(), {
    claimed: 1,
    succeeded: 0,
    failed: 0,
    released: 1,
  });
  assert.deepEqual(releasedError, { message: "provider unavailable" });
});

test("reasoning outage pauses provider work without coupling deterministic execution", () => {
  const outage = new ReasoningOutageStateMachine({ failureThreshold: 2, retryAfterMs: 1000 });
  const firstFailure = outage.recordFailure(new Date("2026-09-09T00:00:00.000Z"));
  assert.equal(firstFailure.state, "DEGRADED");
  assert.equal(outage.canAttempt(new Date("2026-09-09T00:00:00.500Z")), true);

  const paused = outage.recordFailure(new Date("2026-09-09T00:00:01.000Z"));
  assert.equal(paused.state, "PAUSED");
  assert.equal(outage.canAttempt(new Date("2026-09-09T00:00:01.500Z")), false);
  assert.equal(outage.canAttempt(new Date("2026-09-09T00:00:02.000Z")), true);

  assert.equal(outage.recordSuccess().state, "AVAILABLE");
  assert.equal(outage.snapshot().consecutiveFailures, 0);
});

test("reasoning outage state can be restored and persisted through change callbacks", () => {
  const changes: string[] = [];
  const outage = new ReasoningOutageStateMachine({
    initial: {
      state: "PAUSED",
      consecutiveFailures: 2,
      lastFailureAt: "2026-09-09T00:00:00.000Z",
      retryAfter: "2026-09-09T00:01:00.000Z",
    },
    onChange: (snapshot) => changes.push(snapshot.state),
  });
  assert.equal(outage.canAttempt(new Date("2026-09-09T00:00:30.000Z")), false);
  assert.equal(outage.canAttempt(new Date("2026-09-09T00:01:00.000Z")), true);
  assert.equal(outage.recordSuccess().state, "AVAILABLE");
  assert.deepEqual(changes, ["AVAILABLE"]);
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
