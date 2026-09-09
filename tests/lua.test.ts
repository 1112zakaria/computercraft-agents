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
  "../deploy/minecraft/enable-gather.lua",
  "../deploy/minecraft/install-direct.lua",
  "../deploy/minecraft/install-gateway.lua",
];

test("ComputerCraft runtime modules parse as Lua 5.1", () => {
  for (const relativePath of luaFiles) {
    const source = readFileSync(join(runtimeRoot, relativePath), "utf8");
    assert.doesNotThrow(() => parse(source, { luaVersion: "5.1" }), relativePath);
  }
});

test("ComputerCraft HTTP clients preserve connection error details", () => {
  for (const relativePath of ["gateway/http_client.lua", "turtle/direct_http_client.lua"]) {
    const source = readFileSync(join(runtimeRoot, relativePath), "utf8");
    assert.match(source, /response_or_error, request_error/);
    assert.match(source, /request_error or response_or_error or "HTTP request failed"/);
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

test("stable update bootstraps repair a missing CraftOS startup hook", () => {
  for (const relativePath of ["gateway/update_bootstrap.lua", "turtle/update_bootstrap.lua"]) {
    const source = readFileSync(join(runtimeRoot, relativePath), "utf8");
    assert.match(source, /function ensure_startup_hook\(\)/, relativePath);
    assert.match(source, /startup_hook_is_valid/, relativePath);
    assert.match(source, /fs\.isDir\("startup"\)/, relativePath);
    assert.match(source, /startup\.previous/, relativePath);
    assert.match(source, /fs\.move, temporary, "startup"/, relativePath);
    assert.match(source, /shell\.run\("startup\.lua"\)/, relativePath);
  }
  const installer = readFileSync(
    join(runtimeRoot, "../deploy/minecraft/install-direct.lua"),
    "utf8",
  );
  assert.match(installer, /if not valid_startup_hook\(\) then/);
  assert.match(installer, /valid_startup_hook/);
  assert.match(installer, /startup\.previous/);
  assert.match(installer, /worker\.conf\.example/);
  assert.match(installer, /enable-gather\.lua/);
  assert.match(installer, /deployment_root/);
});

test("gateway installer preserves local configuration and repairs startup", () => {
  const installer = readFileSync(
    join(runtimeRoot, "../deploy/minecraft/install-gateway.lua"),
    "utf8",
  );
  assert.match(installer, /gateway\.conf\.example/);
  assert.match(installer, /startup_hook/);
  assert.match(installer, /valid_startup_hook/);
  assert.match(installer, /startup\.previous/);
  assert.match(installer, /gateway\.conf and gateway outbox/);
  assert.match(installer, /expected pinned 40-character commit/);
});

test("gather capability migration preserves configuration with a backup", () => {
  const source = readFileSync(join(runtimeRoot, "../deploy/minecraft/enable-gather.lua"), "utf8");
  assert.match(source, /worker\.conf\.before-gather/);
  assert.match(source, /function ensure_startup_hook\(\)/);
  assert.match(source, /startup\.previous/);
  assert.match(source, /startup\.gather\.tmp/);
  assert.match(source, /startup_hook_is_valid/);
  assert.match(source, /textutils\.serialize/);
  assert.match(source, /mining\.gather/);
  assert.match(source, /navigate\.path/);
  assert.match(source, /inventory\.deposit/);
  assert.match(source, /serialized = textutils\.serialize\(config\)/);
  assert.match(source, /original was restored/);
});

test("stable update bootstraps remove newly introduced files during rollback", () => {
  for (const relativePath of ["gateway/update_bootstrap.lua", "turtle/update_bootstrap.lua"]) {
    const source = readFileSync(join(runtimeRoot, relativePath), "utf8");
    assert.match(
      source,
      /for _, path in ipairs\(journal\.files\) do[\s\S]*?if fs\.exists\(path\) then[\s\S]*?fs\.delete\(path\)[\s\S]*?if fs\.exists\(backup\) then[\s\S]*?fs\.copy\(backup, path\)/,
      relativePath,
    );
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
  assert.match(excavation, /local normalized = string\.lower\(item_key\)/);
  assert.match(excavation, /return "minecraft:" \.\. normalized/);
  assert.match(excavation, /TARGET_NOT_REACHED/);
  assert.match(
    executor,
    /self\.excavation:gather\(args\.itemKey, args\.quantity, args\.maxDepth\)/,
  );
});

test("turtle inventory and excavation normalize namespaced item keys", () => {
  const excavation = readFileSync(join(runtimeRoot, "turtle/excavation.lua"), "utf8");
  const inventory = readFileSync(join(runtimeRoot, "turtle/inventory.lua"), "utf8");
  assert.match(excavation, /local normalized = string\.lower\(item_key\)/);
  assert.match(inventory, /local normalized = string\.lower\(item_key\)/);
  assert.match(excavation, /return normalized/);
  assert.match(inventory, /return normalized/);
});

test("turtle runtime supports allowlisted named container sides", () => {
  const config = readFileSync(join(runtimeRoot, "turtle/config.lua"), "utf8");
  const executor = readFileSync(join(runtimeRoot, "turtle/executor.lua"), "utf8");
  assert.match(config, /container_sides/);
  assert.match(config, /must be front, up, or down/);
  assert.match(executor, /function executor:container_direction\(container_id\)/);
  assert.match(executor, /container is not configured/);
});

test("turtle startup warns when first-use capabilities are omitted", () => {
  const startup = readFileSync(join(runtimeRoot, "turtle/startup.lua"), "utf8");
  assert.match(startup, /advertised_capabilities/);
  assert.match(startup, /mining\.gather/);
  assert.match(startup, /navigate\.path/);
  assert.match(startup, /inventory\.deposit/);
  assert.match(startup, /related commands will be rejected/);
});

test("turtle transfer commands emit post-transfer inventory changes", () => {
  const executor = readFileSync(join(runtimeRoot, "turtle/executor.lua"), "utf8");
  const inventory = readFileSync(join(runtimeRoot, "turtle/inventory.lua"), "utf8");
  assert.match(executor, /result\.inventory = self\.inventory:snapshot\(\)/);
  assert.match(executor, /args\.itemKey/);
  assert.match(inventory, /status = "MISSING_ITEM"/);
  assert.match(inventory, /status = "ITEM_MISMATCH"/);
  assert.match(executor, /"inventory\.changed"/);
  assert.match(executor, /slots = result\.inventory\.slots/);
});

test("turtle gathering stops safely before digging with no usable inventory slot", () => {
  const inventory = readFileSync(join(runtimeRoot, "turtle/inventory.lua"), "utf8");
  const excavation = readFileSync(join(runtimeRoot, "turtle/excavation.lua"), "utf8");
  const executor = readFileSync(join(runtimeRoot, "turtle/executor.lua"), "utf8");
  assert.match(inventory, /function inventory:free_slots\(\)/);
  assert.match(inventory, /function inventory:free_capacity\(item_key\)/);
  assert.match(excavation, /self\.inventory:free_capacity\(item_key\) == 0/);
  assert.match(excavation, /status = "INVENTORY_FULL"/);
  assert.match(executor, /worker inventory is full; deposit items before gathering/);
  assert.match(executor, /self:emit\(command\.commandId, "inventory\.full"/);
  assert.match(executor, /payload\.position = self\.state:position\(\)/);
});

test("turtle inventory normalizes bare item keys for count and withdrawal", () => {
  const inventory = readFileSync(join(runtimeRoot, "turtle/inventory.lua"), "utf8");
  assert.match(inventory, /function normalize_item_key\(item_key\)/);
  assert.match(inventory, /item_key = normalize_item_key\(item_key\)/);
});
