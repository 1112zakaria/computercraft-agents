import assert from "node:assert/strict";
import test from "node:test";

import { protocolVersion } from "../packages/protocol/src/index";
import { selectReadyTasks } from "../packages/scheduler/src/index";

test("workspace exposes protocol version one", () => {
  assert.equal(protocolVersion, 1);
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
