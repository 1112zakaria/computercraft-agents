import assert from "node:assert/strict";
import test from "node:test";

import { protocolVersion } from "../packages/protocol/src/index";
import { parseAddressedGatherGoal } from "../packages/domain/src/index";
import {
  findKnownPath,
  NamedLocationRegistry,
  SparseWorldModel,
  type Coordinate,
} from "../packages/navigation/src/index";
import { selectDispatchableTasks, selectReadyTasks } from "../packages/scheduler/src/index";

test("workspace exposes protocol version one", () => {
  assert.equal(protocolVersion, 1);
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
