import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { parse } from "luaparse";

const runtimeRoot = join(__dirname, "../computercraft");

const luaFiles = [
  "gateway/config.lua",
  "gateway/dispatcher.lua",
  "gateway/gateway.lua",
  "gateway/heartbeat.lua",
  "gateway/http_client.lua",
  "gateway/id.lua",
  "gateway/logging.lua",
  "gateway/outbox.lua",
  "gateway/protocol.lua",
  "gateway/worker_registry.lua",
  "gateway/startup.lua",
  "turtle/cancellation.lua",
  "turtle/config.lua",
  "turtle/executor.lua",
  "turtle/fuel.lua",
  "turtle/id.lua",
  "turtle/idempotency.lua",
  "turtle/inventory.lua",
  "turtle/logging.lua",
  "turtle/movement.lua",
  "turtle/observation.lua",
  "turtle/protocol.lua",
  "turtle/rednet_client.lua",
  "turtle/startup.lua",
  "turtle/state.lua",
];

test("ComputerCraft runtime modules parse as Lua 5.1", () => {
  for (const relativePath of luaFiles) {
    const source = readFileSync(join(runtimeRoot, relativePath), "utf8");
    assert.doesNotThrow(() => parse(source, { luaVersion: "5.1" }), relativePath);
  }
});
