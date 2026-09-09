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
    await runCli(["gather", "alice", "minecraft:cobblestone", "8", "12"]);
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
    await runCli([
      "withdraw",
      "alice",
      "minecraft:cobblestone",
      "8",
      "2",
      "--container-id",
      "test-chest",
    ]);
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
