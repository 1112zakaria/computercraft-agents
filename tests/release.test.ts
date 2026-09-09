import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("release manifest is immutable-tagged and excludes direct worker state", () => {
  execFileSync(process.execPath, ["scripts/package-release.mjs", "v9.8.7"], {
    cwd: root,
    stdio: "ignore",
  });
  const manifest = JSON.parse(
    readFileSync(
      join(root, "dist", "release", "computercraft-lua", "release-manifest.json"),
      "utf8",
    ),
  ) as {
    version: string;
    runtimeFiles: Array<{ path: string; downloadUrl: string }>;
    files: string[];
    excludedPersistentFiles: string[];
    stableBootstrapFiles: string[];
    deploymentUtilityFiles: string[];
  };

  assert.equal(manifest.version, "v9.8.7");
  assert.ok(manifest.runtimeFiles.length > 0);
  assert.ok(manifest.runtimeFiles.every((file) => file.downloadUrl.includes("/v9.8.7/")));
  assert.ok(manifest.excludedPersistentFiles.includes("worker.conf"));
  assert.ok(manifest.excludedPersistentFiles.includes("worker-poll-cursor.json"));
  assert.ok(manifest.excludedPersistentFiles.includes("worker-event-outbox.json"));
  assert.ok(manifest.files.includes("enable-gather.lua"));
  assert.ok(manifest.files.includes("install-direct.lua"));
  assert.ok(manifest.files.includes("install-gateway.lua"));
  assert.deepEqual(manifest.deploymentUtilityFiles, [
    "enable-gather.lua",
    "install-direct.lua",
    "install-gateway.lua",
  ]);
  assert.ok(!manifest.runtimeFiles.some((file) => file.path === "enable-gather.lua"));
  assert.ok(!manifest.runtimeFiles.some((file) => file.path === "install-direct.lua"));
  assert.ok(!manifest.runtimeFiles.some((file) => file.path === "install-gateway.lua"));
  assert.ok(manifest.runtimeFiles.every((file) => !file.path.endsWith("worker.conf")));
  assert.ok(manifest.stableBootstrapFiles.includes("computercraft/turtle/startup"));
  assert.ok(manifest.stableBootstrapFiles.includes("computercraft/gateway/startup"));
  assert.ok(!manifest.runtimeFiles.some((file) => file.path.endsWith("/startup")));
});
