import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../apps/cli/src/main";

test("CLI constructs an authenticated immutable update request", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.CONTROL_PLANE_URL;
  const previousSecret = process.env.CONTROL_PLANE_ADMIN_SECRET;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  process.env.CONTROL_PLANE_URL = "http://control-plane.test";
  process.env.CONTROL_PLANE_ADMIN_SECRET = "test-admin-secret";
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({ updateId: "update-test", status: "QUEUED" }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await runCli(["update", "--target", "worker:alice", "--version", "v0.2.0"]);
    assert.equal(capturedUrl, "http://control-plane.test/v1/updates");
    assert.equal(capturedInit?.method, "POST");
    const body = JSON.parse(String(capturedInit?.body)) as {
      target: string;
      releaseVersion: string;
      manifestUrl: string;
      expiresAt: string;
    };
    assert.equal(body.target, "worker:alice");
    assert.equal(body.releaseVersion, "v0.2.0");
    assert.match(body.manifestUrl, /releases\/download\/v0\.2\.0\/release-manifest\.json$/);
    assert.ok(Date.parse(body.expiresAt) > Date.now());
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI constructs a direct worker provisioning request", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.CONTROL_PLANE_URL;
  const previousSecret = process.env.CONTROL_PLANE_ADMIN_SECRET;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  process.env.CONTROL_PLANE_URL = "http://control-plane.test";
  process.env.CONTROL_PLANE_ADMIN_SECRET = "test-admin-secret";
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({ workerId: "alice", transport: "direct-http" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await runCli([
      "provision-worker",
      "--id",
      "alice",
      "--server",
      "friends-server",
      "--computer-id",
      "21",
      "--version",
      "v0.4.0",
    ]);
    assert.equal(capturedUrl, "http://control-plane.test/v1/workers/provision");
    assert.equal(capturedInit?.method, "POST");
    const body = JSON.parse(String(capturedInit?.body)) as {
      workerId: string;
      transport: string;
      minecraftServerId: string;
      computerId: number;
    };
    assert.equal(body.workerId, "alice");
    assert.equal(body.transport, "direct-http");
    assert.equal(body.minecraftServerId, "friends-server");
    assert.equal(body.computerId, 21);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI constructs a bounded excavation command", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.CONTROL_PLANE_URL;
  const previousSecret = process.env.CONTROL_PLANE_ADMIN_SECRET;
  let capturedInit: RequestInit | undefined;
  process.env.CONTROL_PLANE_URL = "http://control-plane.test";
  process.env.CONTROL_PLANE_ADMIN_SECRET = "test-admin-secret";
  globalThis.fetch = async (_input, init) => {
    capturedInit = init;
    return new Response(JSON.stringify({ accepted: true }), { status: 200 });
  };
  try {
    await runCli(["excavate", "alice", "1", "1", "8"]);
    const body = JSON.parse(String(capturedInit?.body)) as {
      skill: string;
      arguments: { width: number; height: number; depth: number };
      budget: { maxPrimitives: number; maxBlockChanges: number };
    };
    assert.equal(body.skill, "mining.excavate");
    assert.deepEqual(body.arguments, { width: 1, height: 1, depth: 8 });
    assert.deepEqual(body.budget, { maxPrimitives: 24, maxBlockChanges: 8 });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});
