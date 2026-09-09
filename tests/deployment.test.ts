import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("VPS rollout helper validates before restart and never embeds secrets", () => {
  const script = readFileSync(join(__dirname, "../deploy/vps/update-control-plane.sh"), "utf8");
  assert.match(script, /git status --porcelain/);
  assert.match(script, /npm ci/);
  assert.match(script, /npm run check/);
  assert.match(script, /systemctl restart/);
  assert.match(script, /health_url/);
  assert.match(script, /health/);
  assert.doesNotMatch(script, /GATEWAY_BEARER_SECRET|CONTROL_PLANE_ADMIN_SECRET|DATABASE_URL/);
});
