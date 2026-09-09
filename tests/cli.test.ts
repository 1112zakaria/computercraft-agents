import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../apps/cli/src/main";

test("CLI exposes agent and project inspection endpoints", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.CONTROL_PLANE_URL;
  const previousSecret = process.env.CONTROL_PLANE_ADMIN_SECRET;
  const capturedUrls: string[] = [];
  process.env.CONTROL_PLANE_URL = "http://control-plane.test";
  process.env.CONTROL_PLANE_ADMIN_SECRET = "test-admin-secret";
  globalThis.fetch = async (input) => {
    capturedUrls.push(String(input));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    await runCli(["agents"]);
    await runCli(["agent", "alice"]);
    await runCli(["projects"]);
    await runCli(["feature-gates"]);
    await runCli(["audit", "25"]);
    await runCli(["goal-report", "task-report"]);
    await runCli(["planner-triggers", "25"]);
    await runCli(["planner-status"]);
    assert.deepEqual(capturedUrls, [
      "http://control-plane.test/v1/agents",
      "http://control-plane.test/v1/agents/alice",
      "http://control-plane.test/v1/projects",
      "http://control-plane.test/v1/feature-gates",
      "http://control-plane.test/v1/audit?limit=25",
      "http://control-plane.test/v1/goals/task-report/report",
      "http://control-plane.test/v1/planner/triggers?limit=25",
      "http://control-plane.test/v1/planner/status",
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI constructs a read-only goal preflight request", async () => {
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
    return new Response(JSON.stringify({ ready: false, blockers: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await runCli([
      "goal-preflight",
      "@alice",
      "get",
      "8",
      "cobblestone",
      "and",
      "deposit",
      "it",
      "in",
      "Test",
      "Chest",
    ]);
    assert.equal(capturedUrl, "http://control-plane.test/v1/goals/preflight");
    assert.equal(capturedInit?.method, "POST");
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
      protocolVersion: 1,
      goalText: "@alice get 8 cobblestone and deposit it in Test Chest",
      createdByPrincipal: "cli",
      priority: 0,
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

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

test("CLI constructs an operator worker position anchor request", async () => {
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
    return new Response(
      JSON.stringify({
        workerId: "alice",
        position: { confidence: "CONFIRMED_ANCHOR" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    await runCli(["anchor", "alice", "0", "10", "64", "-2", "E"]);
    assert.equal(capturedUrl, "http://control-plane.test/v1/workers/alice/anchor");
    assert.equal(capturedInit?.method, "POST");
    const body = JSON.parse(String(capturedInit?.body)) as {
      protocolVersion: number;
      dimension: number;
      x: number;
      y: number;
      z: number;
      facing: string;
      source: string;
    };
    assert.deepEqual(body, {
      protocolVersion: 1,
      dimension: 0,
      x: 10,
      y: 64,
      z: -2,
      facing: "E",
      source: "operator",
    });
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

test("CLI constructs a bounded target-aware gather command", async () => {
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
    await runCli(["gather", "alice", "cobblestone", "8", "12"]);
    const body = JSON.parse(String(capturedInit?.body)) as {
      skill: string;
      arguments: { itemKey: string; quantity: number; maxDepth: number };
      budget: { maxPrimitives: number; maxBlockChanges: number };
    };
    assert.equal(body.skill, "mining.gather");
    assert.deepEqual(body.arguments, {
      itemKey: "minecraft:cobblestone",
      quantity: 8,
      maxDepth: 12,
    });
    assert.deepEqual(body.budget, { maxPrimitives: 48, maxBlockChanges: 12 });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI requests one task by ID", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.CONTROL_PLANE_URL;
  const previousSecret = process.env.CONTROL_PLANE_ADMIN_SECRET;
  let capturedUrl = "";
  process.env.CONTROL_PLANE_URL = "http://control-plane.test";
  process.env.CONTROL_PLANE_ADMIN_SECRET = "test-admin-secret";
  globalThis.fetch = async (input) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify({ taskId: "task-1", status: "READY" }), { status: 200 });
  };
  try {
    await runCli(["task", "task-1"]);
    assert.equal(capturedUrl, "http://control-plane.test/v1/tasks/task-1");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI dry-run previews a physical command without calling the control plane", async () => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  let fetchCalled = false;
  let output = "";
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  };
  console.log = (...values: unknown[]) => {
    output = values.map(String).join(" ");
  };
  try {
    await runCli(["move", "alice", "N", "--dry-run"]);
    const preview = JSON.parse(output) as {
      dryRun: boolean;
      path: string;
      body: { workerId: string; skill: string; arguments: { direction: string } };
    };
    assert.equal(fetchCalled, false);
    assert.equal(preview.dryRun, true);
    assert.equal(preview.path, "/v1/commands");
    assert.equal(preview.body.workerId, "alice");
    assert.equal(preview.body.skill, "movement.step");
    assert.deepEqual(preview.body.arguments, { direction: "N" });
  } finally {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  }
});

test("CLI constructs a bounded inventory inspection command", async () => {
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
    await runCli(["inspect", "alice"]);
    const body = JSON.parse(String(capturedInit?.body)) as {
      workerId: string;
      skill: string;
      arguments: Record<string, never>;
      budget: { maxPrimitives: number; maxBlockChanges: number };
    };
    assert.equal(body.workerId, "alice");
    assert.equal(body.skill, "inventory.inspect");
    assert.deepEqual(body.arguments, {});
    assert.deepEqual(body.budget, { maxPrimitives: 1, maxBlockChanges: 0 });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI constructs a bounded block observation command", async () => {
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
    await runCli(["observe", "alice", "front"]);
    const body = JSON.parse(String(capturedInit?.body)) as {
      skill: string;
      arguments: { direction: string };
      budget: { maxPrimitives: number; maxBlockChanges: number };
    };
    assert.equal(body.skill, "observation.block");
    assert.deepEqual(body.arguments, { direction: "front" });
    assert.deepEqual(body.budget, { maxPrimitives: 1, maxBlockChanges: 0 });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI dry-run validates and previews an addressed gather goal without persisting it", async () => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const previousPrincipal = process.env.CONTROL_PLANE_PRINCIPAL;
  let fetchCalled = false;
  let output = "";
  process.env.CONTROL_PLANE_PRINCIPAL = "overnight-operator";
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  };
  console.log = (...values: unknown[]) => {
    output = values.map(String).join(" ");
  };
  try {
    await runCli([
      "goal",
      "@alice",
      "get",
      "64",
      "cobblestone",
      "and",
      "deposit",
      "it",
      "in",
      "Test Chest",
      "--dry-run",
    ]);
    const preview = JSON.parse(output) as {
      dryRun: boolean;
      path: string;
      body: { goalText: string; createdByPrincipal: string };
      parsedGoal: {
        targetWorkerId: string;
        itemKey: string;
        quantity: number;
        destination: string;
      };
    };
    assert.equal(fetchCalled, false);
    assert.equal(preview.dryRun, true);
    assert.equal(preview.path, "/v1/goals");
    assert.equal(preview.body.createdByPrincipal, "overnight-operator");
    assert.equal(preview.body.goalText, "@alice get 64 cobblestone and deposit it in Test Chest");
    assert.deepEqual(preview.parsedGoal, {
      targetWorkerId: "alice",
      itemKey: "minecraft:cobblestone",
      quantity: 64,
      destination: "Test Chest",
    });
  } finally {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
    if (previousPrincipal === undefined) delete process.env.CONTROL_PLANE_PRINCIPAL;
    else process.env.CONTROL_PLANE_PRINCIPAL = previousPrincipal;
  }
});

test("CLI constructs a named-container deposit command", async () => {
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
    await runCli(["deposit", "alice", "8", "2", "--container-id", "test-chest"]);
    const body = JSON.parse(String(capturedInit?.body)) as {
      skill: string;
      arguments: { containerId: string; quantity: number; slot: number };
    };
    assert.equal(body.skill, "inventory.deposit");
    assert.deepEqual(body.arguments, { containerId: "test-chest", quantity: 8, slot: 2 });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI canonicalizes an item-targeted deposit command", async () => {
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
    await runCli(["deposit", "alice", "8", "--item-key", "cobblestone"]);
    const body = JSON.parse(String(capturedInit?.body)) as {
      arguments: { itemKey: string; quantity: number };
    };
    assert.deepEqual(body.arguments, { itemKey: "minecraft:cobblestone", quantity: 8 });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI constructs a named-container withdraw command", async () => {
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
    await runCli(["withdraw", "alice", "cobblestone", "8", "2", "--container-id", "test-chest"]);
    const body = JSON.parse(String(capturedInit?.body)) as {
      skill: string;
      arguments: { containerId: string; itemKey: string; quantity: number; slot: number };
    };
    assert.equal(body.skill, "inventory.withdraw");
    assert.deepEqual(body.arguments, {
      containerId: "test-chest",
      itemKey: "minecraft:cobblestone",
      quantity: 8,
      slot: 2,
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI constructs a bounded path command", async () => {
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
    await runCli(["path", "alice", "N", "N", "E"]);
    const body = JSON.parse(String(capturedInit?.body)) as {
      skill: string;
      arguments: { steps: string[] };
      budget: { maxPrimitives: number; maxBlockChanges: number };
    };
    assert.equal(body.skill, "navigate.path");
    assert.deepEqual(body.arguments, { steps: ["N", "N", "E"] });
    assert.deepEqual(body.budget, { maxPrimitives: 3, maxBlockChanges: 0 });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI resolves a named location", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.CONTROL_PLANE_URL;
  const previousSecret = process.env.CONTROL_PLANE_ADMIN_SECRET;
  let capturedUrl = "";
  process.env.CONTROL_PLANE_URL = "http://control-plane.test";
  process.env.CONTROL_PLANE_ADMIN_SECRET = "test-admin-secret";
  globalThis.fetch = async (input) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify({ name: "Test Chest" }), { status: 200 });
  };
  try {
    await runCli(["location", "Test Chest"]);
    assert.equal(capturedUrl, "http://control-plane.test/v1/locations/Test%20Chest");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI creates a confirmed named location", async () => {
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
    return new Response(JSON.stringify({ name: "Test Chest" }), { status: 200 });
  };
  try {
    await runCli(["set-location", "Test Chest", "0", "10", "64", "-2", "E"]);
    assert.equal(capturedUrl, "http://control-plane.test/v1/locations");
    assert.equal(capturedInit?.method, "POST");
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
      protocolVersion: 1,
      name: "Test Chest",
      dimension: 0,
      x: 10,
      y: 64,
      z: -2,
      facing: "E",
      source: "operator",
      confidence: "CONFIRMED_ANCHOR",
      metadata: {},
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI creates a named location with an approach coordinate", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.CONTROL_PLANE_URL;
  const previousSecret = process.env.CONTROL_PLANE_ADMIN_SECRET;
  let capturedInit: RequestInit | undefined;
  process.env.CONTROL_PLANE_URL = "http://control-plane.test";
  process.env.CONTROL_PLANE_ADMIN_SECRET = "test-admin-secret";
  globalThis.fetch = async (_input, init) => {
    capturedInit = init;
    return new Response(JSON.stringify({ name: "Test Chest" }), { status: 200 });
  };
  try {
    await runCli([
      "set-location",
      "Test Chest",
      "0",
      "10",
      "64",
      "-2",
      "E",
      "--approach",
      "0",
      "9",
      "64",
      "-2",
      "N",
    ]);
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
      protocolVersion: 1,
      name: "Test Chest",
      dimension: 0,
      x: 10,
      y: 64,
      z: -2,
      facing: "E",
      approach: { dimension: 0, x: 9, y: 64, z: -2, facing: "N" },
      source: "operator",
      confidence: "CONFIRMED_ANCHOR",
      metadata: {},
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI requests a bounded path to a named location", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.CONTROL_PLANE_URL;
  const previousSecret = process.env.CONTROL_PLANE_ADMIN_SECRET;
  let capturedUrl = "";
  process.env.CONTROL_PLANE_URL = "http://control-plane.test";
  process.env.CONTROL_PLANE_ADMIN_SECRET = "test-admin-secret";
  globalThis.fetch = async (input) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify({ directions: ["E"] }), { status: 200 });
  };
  try {
    await runCli(["path-to", "alice", "Test Chest"]);
    assert.equal(capturedUrl, "http://control-plane.test/v1/workers/alice/path-to/Test%20Chest");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI queues a bounded path to a named location", async () => {
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
    return new Response(JSON.stringify({ accepted: true, status: "QUEUED" }), { status: 202 });
  };
  try {
    await runCli(["go-to", "alice", "Test Chest"]);
    assert.equal(capturedUrl, "http://control-plane.test/v1/workers/alice/path-to/Test%20Chest");
    assert.equal(capturedInit?.method, "POST");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI submits an explicit task transition", async () => {
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
    return new Response(JSON.stringify({ accepted: true, taskId: "task-1", status: "DONE" }), {
      status: 200,
    });
  };
  try {
    await runCli(["task-status", "task-1", "DONE"]);
    assert.equal(capturedUrl, "http://control-plane.test/v1/tasks/task-1/transition");
    assert.equal(capturedInit?.method, "POST");
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
      protocolVersion: 1,
      status: "DONE",
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI exposes explicit pause, resume, and cancel task controls", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.CONTROL_PLANE_URL;
  const previousSecret = process.env.CONTROL_PLANE_ADMIN_SECRET;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  process.env.CONTROL_PLANE_URL = "http://control-plane.test";
  process.env.CONTROL_PLANE_ADMIN_SECRET = "test-admin-secret";
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ accepted: true }), { status: 200 });
  };
  try {
    await runCli(["pause-task", "task-1", "operator", "pause"]);
    await runCli(["resume-task", "task-1"]);
    await runCli(["cancel-task", "task-1", "operator", "cancel"]);
    assert.deepEqual(
      requests.map((request) => ({
        url: request.url,
        status: request.body.status,
        reason: request.body.reason,
      })),
      [
        {
          url: "http://control-plane.test/v1/tasks/task-1/transition",
          status: "PAUSED",
          reason: "operator pause",
        },
        {
          url: "http://control-plane.test/v1/tasks/task-1/transition",
          status: "READY",
          reason: undefined,
        },
        {
          url: "http://control-plane.test/v1/tasks/task-1/transition",
          status: "CANCELLED",
          reason: "operator cancel",
        },
      ],
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI lists runnable tasks", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.CONTROL_PLANE_URL;
  const previousSecret = process.env.CONTROL_PLANE_ADMIN_SECRET;
  let capturedUrl = "";
  process.env.CONTROL_PLANE_URL = "http://control-plane.test";
  process.env.CONTROL_PLANE_ADMIN_SECRET = "test-admin-secret";
  globalThis.fetch = async (input) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify({ tasks: [] }), { status: 200 });
  };
  try {
    await runCli(["runnable-tasks"]);
    assert.equal(capturedUrl, "http://control-plane.test/v1/tasks/runnable");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI dispatches a task to a worker", async () => {
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
    return new Response(JSON.stringify({ accepted: true }), { status: 200 });
  };
  try {
    await runCli(["dispatch-task", "task-1", "alice"]);
    assert.equal(capturedUrl, "http://control-plane.test/v1/tasks/task-1/dispatch");
    assert.equal(capturedInit?.method, "POST");
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
      protocolVersion: 1,
      workerId: "alice",
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI triggers one bounded scheduler tick", async () => {
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
    return new Response(JSON.stringify({ dispatched: [] }), { status: 200 });
  };
  try {
    await runCli(["scheduler-tick"]);
    assert.equal(capturedUrl, "http://control-plane.test/v1/scheduler/tick");
    assert.equal(capturedInit?.method, "POST");
    assert.equal(capturedInit?.body, "{}");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI submits the first addressed gather goal", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.CONTROL_PLANE_URL;
  const previousSecret = process.env.CONTROL_PLANE_ADMIN_SECRET;
  const previousPrincipal = process.env.CONTROL_PLANE_PRINCIPAL;
  let capturedInit: RequestInit | undefined;
  process.env.CONTROL_PLANE_URL = "http://control-plane.test";
  process.env.CONTROL_PLANE_ADMIN_SECRET = "test-admin-secret";
  process.env.CONTROL_PLANE_PRINCIPAL = "test-operator";
  globalThis.fetch = async (_input, init) => {
    capturedInit = init;
    return new Response(JSON.stringify({ taskId: "task-test", status: "READY" }), { status: 202 });
  };
  try {
    await runCli([
      "goal",
      "@alice",
      "get",
      "64",
      "cobblestone",
      "and",
      "deposit",
      "it",
      "in",
      "Test",
      "Chest",
    ]);
    const body = JSON.parse(String(capturedInit?.body)) as {
      goalText: string;
      createdByPrincipal: string;
    };
    assert.equal(body.goalText, "@alice get 64 cobblestone and deposit it in Test Chest");
    assert.equal(body.createdByPrincipal, "test-operator");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
    if (previousPrincipal === undefined) delete process.env.CONTROL_PLANE_PRINCIPAL;
    else process.env.CONTROL_PLANE_PRINCIPAL = previousPrincipal;
  }
});

test("CLI can explicitly start one bounded scheduler tick after creating a goal", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.CONTROL_PLANE_URL;
  const previousSecret = process.env.CONTROL_PLANE_ADMIN_SECRET;
  const capturedRequests: Array<{ url: string; method: string | undefined }> = [];
  process.env.CONTROL_PLANE_URL = "http://control-plane.test";
  process.env.CONTROL_PLANE_ADMIN_SECRET = "test-admin-secret";
  globalThis.fetch = async (input, init) => {
    capturedRequests.push({ url: String(input), method: init?.method });
    const body = String(input).endsWith("/v1/goals")
      ? { taskId: "goal-task", status: "READY" }
      : { dispatched: [{ taskId: "workflow-step", status: "DISPATCHED" }] };
    return new Response(JSON.stringify(body), {
      status: String(input).endsWith("/v1/goals") ? 202 : 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await runCli([
      "goal",
      "@alice",
      "get",
      "8",
      "cobblestone",
      "and",
      "deposit",
      "it",
      "in",
      "Test Chest",
      "--start",
    ]);
    assert.deepEqual(capturedRequests, [
      { url: "http://control-plane.test/v1/goals", method: "POST" },
      { url: "http://control-plane.test/v1/scheduler/tick", method: "POST" },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});

test("CLI requests bounded planning context for a task", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.CONTROL_PLANE_URL;
  const previousSecret = process.env.CONTROL_PLANE_ADMIN_SECRET;
  let capturedUrl = "";
  process.env.CONTROL_PLANE_URL = "http://control-plane.test";
  process.env.CONTROL_PLANE_ADMIN_SECRET = "test-admin-secret";
  globalThis.fetch = async (input) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify({ taskId: "task-test", prompt: "context" }), {
      status: 200,
    });
  };
  try {
    await runCli(["planning-context", "task-test"]);
    assert.equal(capturedUrl, "http://control-plane.test/v1/tasks/task-test/planning-context");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CONTROL_PLANE_URL;
    else process.env.CONTROL_PLANE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CONTROL_PLANE_ADMIN_SECRET;
    else process.env.CONTROL_PLANE_ADMIN_SECRET = previousSecret;
  }
});
