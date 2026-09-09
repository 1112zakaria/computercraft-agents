import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { parse } from "luaparse";

const runtimeRoot = join(__dirname, "../computercraft");

const luaFiles = [
  "gateway/startup",
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
  "gateway/update_bootstrap.lua",
  "gateway/update_manager.lua",
  "turtle/cancellation.lua",
  "turtle/compat.lua",
  "turtle/config.lua",
  "turtle/direct_http_client.lua",
  "turtle/excavation.lua",
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
  "turtle/startup",
  "turtle/startup.lua",
  "turtle/update_bootstrap.lua",
  "turtle/update_manager.lua",
  "turtle/state.lua",
];

test("ComputerCraft runtime modules parse as Lua 5.1", () => {
  for (const relativePath of luaFiles) {
    const source = readFileSync(join(runtimeRoot, relativePath), "utf8");
    assert.doesNotThrow(() => parse(source, { luaVersion: "5.1" }), relativePath);
  }
});

test("direct turtle updater filters the combined release manifest", () => {
  const source = readFileSync(join(runtimeRoot, "turtle/update_manager.lua"), "utf8");
  assert.match(source, /local function is_turtle_runtime_path/);
  assert.match(
    source,
    /if is_turtle_runtime_path\(type\(entry\) == "table" and entry\.path or nil\) then/,
  );
  assert.match(source, /manifest contains no turtle runtime files/);
});

test("gateway and turtle include extensionless CraftOS startup hooks", () => {
  for (const relativePath of ["gateway/startup", "turtle/startup"]) {
    const source = readFileSync(join(runtimeRoot, relativePath), "utf8");
    assert.match(source, /shell\.run\("startup\.lua"\)/, relativePath);
  }
});

test("turtle executor emits a world observation event after block inspection", () => {
  const source = readFileSync(join(runtimeRoot, "turtle/executor.lua"), "utf8");
  assert.match(source, /command\.skill == "observation\.block"/);
  assert.match(source, /self:emit\(command\.commandId, "block\.observed"/);
});

test("turtle runtime exposes bounded target-aware gathering", () => {
  const protocol = readFileSync(join(runtimeRoot, "turtle/protocol.lua"), "utf8");
  const excavation = readFileSync(join(runtimeRoot, "turtle/excavation.lua"), "utf8");
  const executor = readFileSync(join(runtimeRoot, "turtle/executor.lua"), "utf8");
  assert.match(protocol, /\["mining\.gather"\] = true/);
  assert.match(protocol, /maxDepth/);
  assert.match(excavation, /function excavation:gather\(item_key, quantity, max_depth\)/);
  assert.match(excavation, /TARGET_NOT_REACHED/);
  assert.match(
    executor,
    /self\.excavation:gather\(args\.itemKey, args\.quantity, args\.maxDepth\)/,
  );
});
