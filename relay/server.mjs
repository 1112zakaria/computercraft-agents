import { createServer } from "node:http";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_PORT = 8788;
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_LEASE_MS = 60 * 60 * 1000;
export const MAX_PROGRAM_BYTES = 1 << 20;
export const MAX_REQUEST_BYTES = MAX_PROGRAM_BYTES + 64 * 1024;

const JOB_STATES = new Set(["pending", "claimed", "done", "failed"]);
const WORKER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function integerEnv(value, fallback, minimum) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

export function readRelayConfig(env = process.env) {
  const authEnabled = parseBoolean(env.RELAY_AUTH_ENABLED, false);
  const secret = String(env.RELAY_SECRET ?? "").trim();
  if (authEnabled && secret.length === 0) {
    throw new Error("RELAY_SECRET is required when RELAY_AUTH_ENABLED=true");
  }
  return {
    host: String(env.RELAY_HOST ?? DEFAULT_HOST).trim() || DEFAULT_HOST,
    port: integerEnv(env.RELAY_PORT, DEFAULT_PORT, 1),
    dataPath: String(env.RELAY_DATA_PATH ?? join(process.cwd(), "relay", "relay-data.json")).trim(),
    leaseMs: integerEnv(env.RELAY_LEASE_MS, DEFAULT_LEASE_MS, 1),
    authEnabled,
    secret,
  };
}

function isValidWorkerId(workerId) {
  return workerId === "" || WORKER_ID_PATTERN.test(workerId);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function timestamp(value) {
  return new Date(value).toISOString();
}

export class RelayStore {
  constructor({ dataPath = "", leaseMs = DEFAULT_LEASE_MS, now = () => Date.now() } = {}) {
    this.dataPath = dataPath;
    this.leaseMs = leaseMs;
    this.now = now;
    this.nextSeq = 0;
    this.jobs = [];
    this.stopRequests = new Map();
    this.load();
  }

  load() {
    if (!this.dataPath) return;
    let raw;
    try {
      raw = readFileSync(this.dataPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    const persisted = JSON.parse(raw);
    this.nextSeq = Number.isSafeInteger(persisted.nextSeq) ? persisted.nextSeq : 0;
    this.jobs = Array.isArray(persisted.jobs) ? persisted.jobs.filter(Boolean) : [];
    for (const job of this.jobs) {
      if (!JOB_STATES.has(job.state)) job.state = "pending";
      if (!Number.isSafeInteger(job.seq)) job.seq = 0;
      if (job.seq > this.nextSeq) this.nextSeq = job.seq;
    }
    this.jobs.sort((left, right) => left.seq - right.seq);
  }

  save() {
    if (!this.dataPath) return;
    mkdirSync(dirname(this.dataPath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.dataPath}.tmp`;
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({ nextSeq: this.nextSeq, jobs: this.jobs }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    renameSync(temporaryPath, this.dataPath);
  }

  addJob({ name = "", filename = "", program, targetWorker = "" }) {
    if (typeof program !== "string" || program.trim().length === 0) {
      throw new Error("program is required and must not be empty");
    }
    if (Buffer.byteLength(program, "utf8") > MAX_PROGRAM_BYTES) {
      throw new Error(`program exceeds ${MAX_PROGRAM_BYTES} bytes`);
    }
    if (!isValidWorkerId(targetWorker)) throw new Error("target_worker is invalid");

    this.nextSeq += 1;
    const id = `j${this.nextSeq}`;
    const job = {
      id,
      seq: this.nextSeq,
      name: String(name),
      filename: filename || `job_${id}.lua`,
      target_worker: targetWorker,
      program,
      state: "pending",
      attempts: 0,
      created_at: timestamp(this.now()),
    };
    this.jobs.push(job);
    this.save();
    return clone(job);
  }

  runnableBy(job, workerId) {
    return job.target_worker === "" || (workerId !== "" && job.target_worker === workerId);
  }

  claimNext(workerId) {
    const now = this.now();
    let selected = this.jobs.find(
      (job) => job.state === "pending" && this.runnableBy(job, workerId),
    );
    if (!selected) {
      selected = this.jobs.find((job) => {
        if (job.state !== "claimed" || !this.runnableBy(job, workerId)) return false;
        if (!job.claimed_at) return false;
        return now - Date.parse(job.claimed_at) >= this.leaseMs;
      });
    }
    if (!selected) return null;

    selected.state = "claimed";
    selected.claimed_at = timestamp(now);
    selected.attempts += 1;
    this.save();
    return clone(selected);
  }

  setResult(id, workerId, result) {
    const job = this.jobs.find((candidate) => candidate.id === id);
    if (!job) return { error: "not_found" };
    if (job.target_worker && job.target_worker !== workerId) return { error: "wrong_worker" };
    job.result = {
      ok: Boolean(result.ok),
      ...(result.output ? { output: String(result.output) } : {}),
      ...(result.error ? { error: String(result.error) } : {}),
    };
    job.finished_at = timestamp(this.now());
    job.state = result.ok ? "done" : "failed";
    this.save();
    return { job: clone(job) };
  }

  list(state = "", limit = 50) {
    return this.jobs
      .filter((job) => !state || job.state === state)
      .slice()
      .reverse()
      .slice(0, limit)
      .map(clone);
  }

  counts() {
    const counts = { pending: 0, claimed: 0, done: 0, failed: 0 };
    for (const job of this.jobs) counts[job.state] = (counts[job.state] ?? 0) + 1;
    return counts;
  }

  requestStop(workerId, reason = "operator stop") {
    this.stopRequests.set(workerId, String(reason));
  }

  stopStatus(workerId) {
    const reason = this.stopRequests.get(workerId);
    return reason === undefined ? { requested: false, reason: "" } : { requested: true, reason };
  }

  clearStop(workerId) {
    this.stopRequests.delete(workerId);
  }
}

function sendJson(response, status, body) {
  const payload = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sendText(response, status, body) {
  const payload = body ?? "";
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function readBody(request, limit = MAX_REQUEST_BYTES) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        rejectBody(Object.assign(new Error("request body is too large"), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.on("error", rejectBody);
  });
}

function parseJsonBody(body) {
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error("invalid JSON body"), { statusCode: 400 });
  }
}

function parseResult(body) {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    const value = parseJsonBody(trimmed);
    if (typeof value.ok !== "boolean") {
      throw Object.assign(new Error("result JSON requires boolean ok"), { statusCode: 400 });
    }
    return value;
  }
  const newline = body.indexOf("\n");
  const firstLine = (newline < 0 ? body : body.slice(0, newline)).replace(/\r$/, "");
  const message = newline < 0 ? "" : body.slice(newline + 1).replace(/[\r\n]+$/, "");
  if (firstLine === "ok") return { ok: true, output: message };
  if (firstLine === "error") return { ok: false, error: message };
  throw Object.assign(new Error('result must start with "ok" or "error"'), { statusCode: 400 });
}

function bearerMatches(request, config) {
  if (!config.authEnabled) return true;
  return request.headers.authorization === `Bearer ${config.secret}`;
}

function requireWorkerId(value) {
  const workerId = value ?? "";
  if (!WORKER_ID_PATTERN.test(workerId)) {
    throw Object.assign(
      new Error(
        "worker_id must be 1-64 characters using letters, numbers, dot, dash, or underscore",
      ),
      { statusCode: 400 },
    );
  }
  return workerId;
}

async function handleRequest(request, response, { store, config }) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const path = url.pathname;

  if (request.method === "GET" && path === "/healthz") {
    sendText(response, 200, "ok\n");
    return;
  }
  if (path.startsWith("/api/") && !bearerMatches(request, config)) {
    sendJson(response, 401, { error: "authentication required" });
    return;
  }

  if (request.method === "POST" && path === "/api/v1/jobs") {
    const body = parseJsonBody(await readBody(request));
    const job = store.addJob({
      name: body.name ?? "",
      filename: body.filename ?? "",
      targetWorker: body.target_worker ?? "",
      program: body.program,
    });
    sendJson(response, 201, job);
    return;
  }

  if (request.method === "GET" && path === "/api/v1/jobs/next") {
    const workerId = url.searchParams.get("worker_id") ?? "";
    if (!isValidWorkerId(workerId))
      throw Object.assign(new Error("worker_id is invalid"), { statusCode: 400 });
    if (store.stopStatus(workerId).requested) {
      sendText(response, 200, "");
      return;
    }
    const job = store.claimNext(workerId);
    if (!job) {
      sendText(response, 200, "");
      return;
    }
    sendText(response, 200, `${job.id}\n${job.filename}\n${job.program}`);
    return;
  }

  const resultMatch = path.match(/^\/api\/v1\/jobs\/([^/]+)\/result$/);
  if (request.method === "POST" && resultMatch) {
    const workerId = url.searchParams.get("worker_id") ?? "";
    if (!isValidWorkerId(workerId))
      throw Object.assign(new Error("worker_id is invalid"), { statusCode: 400 });
    const result = parseResult(await readBody(request));
    const outcome = store.setResult(decodeURIComponent(resultMatch[1]), workerId, result);
    if (outcome.error === "not_found") {
      sendJson(response, 404, { error: "no such job" });
      return;
    }
    if (outcome.error === "wrong_worker") {
      sendJson(response, 409, { error: "job belongs to a different worker" });
      return;
    }
    sendJson(response, 200, outcome.job);
    return;
  }

  if (request.method === "GET" && path === "/api/v1/jobs") {
    const state = url.searchParams.get("state") ?? "";
    if (state && !JOB_STATES.has(state))
      throw Object.assign(new Error("invalid state"), { statusCode: 400 });
    const requestedLimit = Number(url.searchParams.get("limit") ?? 50);
    const limit =
      Number.isSafeInteger(requestedLimit) && requestedLimit >= 1 && requestedLimit <= 500
        ? requestedLimit
        : 50;
    const jobs = store.list(state, limit);
    sendJson(response, 200, { jobs, count: jobs.length, total: store.jobs.length });
    return;
  }

  if (request.method === "POST" && path === "/api/v1/stop") {
    const body = parseJsonBody(await readBody(request));
    const workerId = requireWorkerId(body.worker_id);
    store.requestStop(workerId, body.reason ?? "operator stop");
    sendJson(response, 202, { accepted: true, worker_id: workerId });
    return;
  }

  if (request.method === "GET" && path === "/api/v1/stop") {
    const workerId = requireWorkerId(url.searchParams.get("worker_id"));
    const status = store.stopStatus(workerId);
    sendText(response, 200, status.requested ? `stop\n${status.reason}` : "");
    return;
  }

  if (request.method === "POST" && path === "/api/v1/stop/clear") {
    const rawBody = await readBody(request);
    const body = rawBody.trim().startsWith("{")
      ? parseJsonBody(rawBody)
      : { worker_id: rawBody.trim() };
    const workerId = requireWorkerId(body.worker_id);
    store.clearStop(workerId);
    sendJson(response, 200, { cleared: true, worker_id: workerId });
    return;
  }

  sendJson(response, 404, { error: "not found" });
}

export function createRelayServer({ config = readRelayConfig(), store } = {}) {
  const relayStore =
    store ?? new RelayStore({ dataPath: config.dataPath, leaseMs: config.leaseMs });
  const server = createServer((request, response) => {
    handleRequest(request, response, { store: relayStore, config }).catch((error) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      sendJson(response, status, {
        error: error instanceof Error ? error.message : "request failed",
      });
    });
  });
  server.relayStore = relayStore;
  server.relayConfig = config;
  return server;
}

function isMainModule() {
  return process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isMainModule()) {
  const config = readRelayConfig();
  const server = createRelayServer({ config });
  server.listen(config.port, config.host, () => {
    console.log(`MVP relay listening at http://${config.host}:${config.port}`);
    console.log(`Authentication: ${config.authEnabled ? "enabled" : "disabled"}`);
    console.log(`Job store: ${config.dataPath || "memory"}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
