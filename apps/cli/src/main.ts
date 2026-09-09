import { randomUUID } from "node:crypto";

import { normalizeItemKey, parseAddressedGatherGoal } from "@computercraft-agents/domain";
import {
  DirectionSchema,
  DirectWorkerProvisionSchema,
  GoalCreateRequestSchema,
  IdentifierSchema,
  NamedLocationCreateRequestSchema,
  PeripheralSideSchema,
  ReleaseVersionSchema,
  RelativeDirectionSchema,
  UpdateRequestSchema,
  UpdateTargetSchema,
  WorkerAnchorRequestSchema,
} from "@computercraft-agents/protocol";

export const cliName = "computercraft-agents" as const;

export function usage(): string {
  return [
    `${cliName} workers`,
    `${cliName} workers <worker-id>`,
    `${cliName} provision-worker --id <worker-id> --server <server-id> --computer-id <number> --version <version>`,
    `${cliName} diagnose`,
    `${cliName} agents`,
    `${cliName} agent <name>`,
    `${cliName} projects`,
    `${cliName} feature-gates`,
    `${cliName} audit [limit]`,
    `${cliName} goal <@worker get ... and deposit it in ...> [--start] [--dry-run]`,
    `${cliName} goal-preflight <@worker get ... and deposit it in ...>`,
    `${cliName} goal-report <task-id>`,
    `${cliName} planner-triggers [limit]`,
    `${cliName} planner-status`,
    `${cliName} tasks`,
    `${cliName} task <task-id>`,
    `${cliName} planning-context <task-id>`,
    `${cliName} runnable-tasks`,
    `${cliName} scheduler-tick`,
    `${cliName} claim-task <task-id> <worker-id>`,
    `${cliName} dispatch-task <task-id> <worker-id>`,
    `${cliName} task-status <task-id> <PENDING|READY|RUNNING|PAUSED|BLOCKED|DONE|FAILED|CANCELLED>`,
    `${cliName} pause-task <task-id> [reason]`,
    `${cliName} resume-task <task-id>`,
    `${cliName} cancel-task <task-id> [reason]`,
    `${cliName} locations`,
    `${cliName} location <name>`,
    `${cliName} set-location <name> <dimension> <x> <y> <z> [N|E|S|W] [--approach <dimension> <x> <y> <z> [N|E|S|W]]`,
    `${cliName} world-cells`,
    `${cliName} anchor <worker-id> <dimension> <x> <y> <z> [N|E|S|W]`,
    `${cliName} inspect <worker-id> [--dry-run]`,
    `${cliName} peripherals <worker-id> [top|bottom|front|back|left|right] [--dry-run]`,
    `${cliName} observe <worker-id> <front|up|down> [--dry-run]`,
    `${cliName} move <worker-id> <N|E|S|W|UP|DOWN> [--dry-run]`,
    `${cliName} path <worker-id> <N|E|S|W|UP|DOWN>... [--dry-run]`,
    `${cliName} path-to <worker-id> <location-name>`,
    `${cliName} go-to <worker-id> <location-name>`,
    `${cliName} excavate <worker-id> <width> <height> <depth> [--dry-run]`,
    `${cliName} gather <worker-id> <item-key> <quantity> <max-depth> [--dry-run]`,
    `${cliName} deposit <worker-id> [quantity] [slot] [--container-id <id>] [--item-key <id>] [--dry-run]`,
    `${cliName} withdraw <worker-id> <item-key> <quantity> [slot] [--container-id <id>] [--dry-run]`,
    `${cliName} stop <worker-id|all> [--dry-run]`,
    `${cliName} update --target <gateway:id|worker:id|fleet:gateway-id> --version <vX.Y.Z> [--dry-run]`,
    `${cliName} update-status <update-id>`,
  ].join("\n");
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function apiUrl(path: string): string {
  const base = process.env.CONTROL_PLANE_URL?.trim() || "http://127.0.0.1:8787";
  return `${base.replace(/\/$/, "")}${path}`;
}

function adminHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Control-Plane-Secret": requiredEnvironment("CONTROL_PLANE_ADMIN_SECRET"),
  };
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: { ...adminHeaders(), ...init.headers },
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`control plane returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function timestampAfterMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function flag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1]?.trim() : undefined;
}

function manifestUrl(version: string): string {
  const template =
    process.env.UPDATE_MANIFEST_URL_TEMPLATE?.trim() ??
    "https://github.com/1112zakaria/computercraft-agents/releases/download/{version}/release-manifest.json";
  return template.replaceAll("{version}", encodeURIComponent(version));
}

async function postOrPreview(path: string, body: unknown, dryRun: boolean): Promise<unknown> {
  if (dryRun) return { dryRun: true, method: "POST", path, body };
  return request(path, { method: "POST", body: JSON.stringify(body) });
}

export async function runCli(args: readonly string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const startGoal = args.includes("--start");
  const positionalArgs = args.filter(
    (argument) => argument !== "--dry-run" && argument !== "--start",
  );
  const [command, first, second] = positionalArgs.map((argument) => argument.trim());
  if (startGoal && command !== "goal") {
    throw new Error("--start is supported only for goal");
  }
  if (
    dryRun &&
    (command === undefined ||
      !new Set([
        "move",
        "inspect",
        "peripherals",
        "observe",
        "path",
        "excavate",
        "gather",
        "deposit",
        "withdraw",
        "stop",
        "update",
        "goal",
      ]).has(command))
  ) {
    throw new Error(
      "--dry-run is supported for goal, move, inspect, peripherals, observe, path, excavate, gather, deposit, withdraw, stop, and update",
    );
  }
  if (command === "provision-worker") {
    const workerId = flag(args, "--id");
    const minecraftServerId = flag(args, "--server");
    const computerId = flag(args, "--computer-id");
    const runtimeVersion = flag(args, "--version");
    if (!workerId || !minecraftServerId || !computerId || !runtimeVersion) {
      throw new Error(
        `usage: ${cliName} provision-worker --id <worker-id> --server <server-id> --computer-id <number> --version <version>`,
      );
    }
    const parsedComputerId = Number(computerId);
    const provision = DirectWorkerProvisionSchema.parse({
      protocolVersion: 1,
      transport: "direct-http",
      workerId,
      minecraftServerId,
      computerId: parsedComputerId,
      runtimeVersion,
      capabilities: [],
    });
    console.log(
      JSON.stringify(
        await request("/v1/workers/provision", { method: "POST", body: JSON.stringify(provision) }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "workers") {
    const path = first ? `/v1/workers/${encodeURIComponent(first)}` : "/v1/workers";
    console.log(JSON.stringify(await request(path), null, 2));
    return;
  }
  if (command === "diagnose") {
    console.log(JSON.stringify(await request("/v1/diagnostics"), null, 2));
    return;
  }
  if (command === "agents") {
    if (first) throw new Error(`usage: ${cliName} agents`);
    console.log(JSON.stringify(await request("/v1/agents"), null, 2));
    return;
  }
  if (command === "agent") {
    if (!first || second) throw new Error(`usage: ${cliName} agent <name>`);
    console.log(JSON.stringify(await request(`/v1/agents/${encodeURIComponent(first)}`), null, 2));
    return;
  }
  if (command === "projects") {
    if (first) throw new Error(`usage: ${cliName} projects`);
    console.log(JSON.stringify(await request("/v1/projects"), null, 2));
    return;
  }
  if (command === "feature-gates") {
    if (first) throw new Error(`usage: ${cliName} feature-gates`);
    console.log(JSON.stringify(await request("/v1/feature-gates"), null, 2));
    return;
  }
  if (command === "audit") {
    if (second || (first !== undefined && !/^\d+$/.test(first))) {
      throw new Error(`usage: ${cliName} audit [limit]`);
    }
    const path = first ? `/v1/audit?limit=${encodeURIComponent(first)}` : "/v1/audit";
    console.log(JSON.stringify(await request(path), null, 2));
    return;
  }
  if (command === "goal") {
    if (dryRun && startGoal) {
      throw new Error("goal cannot combine --start with --dry-run");
    }
    const goalText = positionalArgs.slice(1).join(" ").trim();
    if (!goalText) {
      throw new Error(`usage: ${cliName} goal <@worker get ... and deposit it in ...>`);
    }
    const body = GoalCreateRequestSchema.parse({
      protocolVersion: 1,
      goalText,
      createdByPrincipal: process.env.CONTROL_PLANE_PRINCIPAL?.trim() || "cli",
      priority: 0,
    });
    if (dryRun) {
      const parsed = parseAddressedGatherGoal(goalText);
      if (!parsed.ok) throw new Error(parsed.error);
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            method: "POST",
            path: "/v1/goals",
            body,
            parsedGoal: parsed.goal,
          },
          null,
          2,
        ),
      );
      return;
    }
    const goal = await request("/v1/goals", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (startGoal) {
      console.log(
        JSON.stringify(
          {
            goal,
            scheduler: await request("/v1/scheduler/tick", {
              method: "POST",
              body: "{}",
            }),
          },
          null,
          2,
        ),
      );
      return;
    }
    console.log(JSON.stringify(goal, null, 2));
    return;
  }
  if (command === "goal-preflight") {
    const goalText = positionalArgs.slice(1).join(" ").trim();
    if (!goalText) {
      throw new Error(`usage: ${cliName} goal-preflight <@worker get ... and deposit it in ...>`);
    }
    const body = GoalCreateRequestSchema.parse({
      protocolVersion: 1,
      goalText,
      createdByPrincipal: process.env.CONTROL_PLANE_PRINCIPAL?.trim() || "cli",
      priority: 0,
    });
    console.log(
      JSON.stringify(
        await request("/v1/goals/preflight", { method: "POST", body: JSON.stringify(body) }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "tasks") {
    if (first) throw new Error(`usage: ${cliName} tasks`);
    console.log(JSON.stringify(await request("/v1/tasks"), null, 2));
    return;
  }
  if (command === "goal-report") {
    if (!first || second) throw new Error(`usage: ${cliName} goal-report <task-id>`);
    console.log(
      JSON.stringify(await request(`/v1/goals/${encodeURIComponent(first)}/report`), null, 2),
    );
    return;
  }
  if (command === "planner-triggers") {
    if (second || (first !== undefined && !/^\d+$/.test(first))) {
      throw new Error(`usage: ${cliName} planner-triggers [limit]`);
    }
    const path = first
      ? `/v1/planner/triggers?limit=${encodeURIComponent(first)}`
      : "/v1/planner/triggers";
    console.log(JSON.stringify(await request(path), null, 2));
    return;
  }
  if (command === "planner-status") {
    if (first) throw new Error(`usage: ${cliName} planner-status`);
    console.log(JSON.stringify(await request("/v1/planner/status"), null, 2));
    return;
  }
  if (command === "task") {
    if (!first || second) throw new Error(`usage: ${cliName} task <task-id>`);
    console.log(JSON.stringify(await request(`/v1/tasks/${encodeURIComponent(first)}`), null, 2));
    return;
  }
  if (command === "planning-context") {
    if (!first || second) throw new Error(`usage: ${cliName} planning-context <task-id>`);
    console.log(
      JSON.stringify(
        await request(`/v1/tasks/${encodeURIComponent(first)}/planning-context`),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "runnable-tasks") {
    if (first) throw new Error(`usage: ${cliName} runnable-tasks`);
    console.log(JSON.stringify(await request("/v1/tasks/runnable"), null, 2));
    return;
  }
  if (command === "scheduler-tick") {
    if (first) throw new Error(`usage: ${cliName} scheduler-tick`);
    console.log(
      JSON.stringify(await request("/v1/scheduler/tick", { method: "POST", body: "{}" }), null, 2),
    );
    return;
  }
  if (command === "claim-task") {
    if (!first || !second) {
      throw new Error(`usage: ${cliName} claim-task <task-id> <worker-id>`);
    }
    console.log(
      JSON.stringify(
        await request(`/v1/tasks/${encodeURIComponent(first)}`, {
          method: "POST",
          body: JSON.stringify({ workerId: second }),
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "dispatch-task") {
    if (!first || !second) {
      throw new Error(`usage: ${cliName} dispatch-task <task-id> <worker-id>`);
    }
    console.log(
      JSON.stringify(
        await request(`/v1/tasks/${encodeURIComponent(first)}/dispatch`, {
          method: "POST",
          body: JSON.stringify({ protocolVersion: 1, workerId: second }),
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "task-status") {
    const allowed = new Set([
      "PENDING",
      "READY",
      "RUNNING",
      "PAUSED",
      "BLOCKED",
      "DONE",
      "FAILED",
      "CANCELLED",
    ]);
    if (!first || !second || !allowed.has(second)) {
      throw new Error(
        `usage: ${cliName} task-status <task-id> <PENDING|READY|RUNNING|PAUSED|BLOCKED|DONE|FAILED|CANCELLED>`,
      );
    }
    console.log(
      JSON.stringify(
        await request(`/v1/tasks/${encodeURIComponent(first)}/transition`, {
          method: "POST",
          body: JSON.stringify({ protocolVersion: 1, status: second }),
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "pause-task" || command === "resume-task" || command === "cancel-task") {
    if (!first || (second && command === "resume-task")) {
      throw new Error(
        command === "resume-task"
          ? `usage: ${cliName} resume-task <task-id>`
          : `usage: ${cliName} ${command} <task-id> [reason]`,
      );
    }
    const status =
      command === "pause-task" ? "PAUSED" : command === "resume-task" ? "READY" : "CANCELLED";
    const reason = positionalArgs.slice(2).join(" ").trim();
    console.log(
      JSON.stringify(
        await request(`/v1/tasks/${encodeURIComponent(first)}/transition`, {
          method: "POST",
          body: JSON.stringify({
            protocolVersion: 1,
            status,
            ...(reason ? { reason } : {}),
          }),
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "locations") {
    if (first) throw new Error(`usage: ${cliName} locations`);
    console.log(JSON.stringify(await request("/v1/locations"), null, 2));
    return;
  }
  if (command === "location") {
    if (!first || second) throw new Error(`usage: ${cliName} location <name>`);
    console.log(
      JSON.stringify(await request(`/v1/locations/${encodeURIComponent(first)}`), null, 2),
    );
    return;
  }
  if (command === "set-location") {
    const approachIndex = positionalArgs.indexOf("--approach");
    const locationArgs = positionalArgs.slice(1, approachIndex === -1 ? undefined : approachIndex);
    const approachArgs = approachIndex === -1 ? [] : positionalArgs.slice(approachIndex + 1);
    const dimension = Number(locationArgs[1]);
    const x = Number(locationArgs[2]);
    const y = Number(locationArgs[3]);
    const z = Number(locationArgs[4]);
    const facing = locationArgs[5];
    const approachDimension = Number(approachArgs[0]);
    const approachX = Number(approachArgs[1]);
    const approachY = Number(approachArgs[2]);
    const approachZ = Number(approachArgs[3]);
    const approachFacing = approachArgs[4];
    const hasApproach = approachIndex !== -1;
    if (
      !first ||
      ![dimension, x, y, z].every((value) => Number.isInteger(value)) ||
      (facing !== undefined && !["N", "E", "S", "W"].includes(facing)) ||
      (hasApproach &&
        (![approachDimension, approachX, approachY, approachZ].every((value) =>
          Number.isInteger(value),
        ) ||
          (approachFacing !== undefined && !["N", "E", "S", "W"].includes(approachFacing))))
    ) {
      throw new Error(
        `usage: ${cliName} set-location <name> <dimension> <x> <y> <z> [N|E|S|W] [--approach <dimension> <x> <y> <z> [N|E|S|W]]`,
      );
    }
    const locationRequest = NamedLocationCreateRequestSchema.parse({
      protocolVersion: 1,
      name: first,
      dimension,
      x,
      y,
      z,
      ...(facing === undefined ? {} : { facing }),
      ...(hasApproach
        ? {
            approach: {
              dimension: approachDimension,
              x: approachX,
              y: approachY,
              z: approachZ,
              ...(approachFacing === undefined ? {} : { facing: approachFacing }),
            },
          }
        : {}),
      source: "operator",
      confidence: "CONFIRMED_ANCHOR",
      metadata: {},
    });
    console.log(
      JSON.stringify(
        await request("/v1/locations", {
          method: "POST",
          body: JSON.stringify(locationRequest),
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "world-cells") {
    if (first) throw new Error(`usage: ${cliName} world-cells`);
    console.log(JSON.stringify(await request("/v1/world/cells"), null, 2));
    return;
  }
  if (command === "anchor") {
    const dimension = Number(positionalArgs[2]);
    const x = Number(positionalArgs[3]);
    const y = Number(positionalArgs[4]);
    const z = Number(positionalArgs[5]);
    const facing = positionalArgs[6];
    if (
      !first ||
      ![dimension, x, y, z].every((value) => Number.isInteger(value)) ||
      (facing !== undefined && !["N", "E", "S", "W"].includes(facing))
    ) {
      throw new Error(`usage: ${cliName} anchor <worker-id> <dimension> <x> <y> <z> [N|E|S|W]`);
    }
    const anchorRequest = WorkerAnchorRequestSchema.parse({
      protocolVersion: 1,
      dimension,
      x,
      y,
      z,
      ...(facing === undefined ? {} : { facing }),
      source: "operator",
    });
    console.log(
      JSON.stringify(
        await request(`/v1/workers/${encodeURIComponent(first)}/anchor`, {
          method: "POST",
          body: JSON.stringify(anchorRequest),
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "move") {
    if (!first || !second || !DirectionSchema.safeParse(second).success) {
      throw new Error(`usage: ${cliName} move <worker-id> <N|E|S|W|UP|DOWN>`);
    }
    const body = {
      protocolVersion: 1,
      commandId: `cli-${randomUUID()}`,
      workerId: first,
      issuedAt: new Date().toISOString(),
      expiresAt: timestampAfterMinutes(5),
      budget: { maxPrimitives: 1, maxBlockChanges: 0 },
      skill: "movement.step",
      arguments: { direction: second },
    };
    console.log(JSON.stringify(await postOrPreview("/v1/commands", body, dryRun), null, 2));
    return;
  }
  if (command === "inspect") {
    if (!first || second) {
      throw new Error(`usage: ${cliName} inspect <worker-id>`);
    }
    const body = {
      protocolVersion: 1,
      commandId: `cli-${randomUUID()}`,
      workerId: first,
      issuedAt: new Date().toISOString(),
      expiresAt: timestampAfterMinutes(5),
      budget: { maxPrimitives: 1, maxBlockChanges: 0 },
      skill: "inventory.inspect" as const,
      arguments: {},
    };
    console.log(JSON.stringify(await postOrPreview("/v1/commands", body, dryRun), null, 2));
    return;
  }
  if (command === "peripherals") {
    if (!first || (second && !PeripheralSideSchema.safeParse(second).success)) {
      throw new Error(
        `usage: ${cliName} peripherals <worker-id> [top|bottom|front|back|left|right]`,
      );
    }
    const body = {
      protocolVersion: 1,
      commandId: `cli-${randomUUID()}`,
      workerId: first,
      issuedAt: new Date().toISOString(),
      expiresAt: timestampAfterMinutes(5),
      budget: { maxPrimitives: second ? 1 : 6, maxBlockChanges: 0 },
      skill: "peripheral.inspect" as const,
      arguments: second ? { side: second } : {},
    };
    console.log(JSON.stringify(await postOrPreview("/v1/commands", body, dryRun), null, 2));
    return;
  }
  if (command === "observe") {
    if (!first || !second || !RelativeDirectionSchema.safeParse(second).success) {
      throw new Error(`usage: ${cliName} observe <worker-id> <front|up|down>`);
    }
    const body = {
      protocolVersion: 1,
      commandId: `cli-${randomUUID()}`,
      workerId: first,
      issuedAt: new Date().toISOString(),
      expiresAt: timestampAfterMinutes(5),
      budget: { maxPrimitives: 1, maxBlockChanges: 0 },
      skill: "observation.block" as const,
      arguments: { direction: second as "front" | "up" | "down" },
    };
    console.log(JSON.stringify(await postOrPreview("/v1/commands", body, dryRun), null, 2));
    return;
  }
  if (command === "path") {
    const steps = positionalArgs.slice(2);
    if (
      !first ||
      steps.length < 1 ||
      steps.length > 64 ||
      steps.some((step) => !DirectionSchema.safeParse(step).success)
    ) {
      throw new Error(`usage: ${cliName} path <worker-id> <N|E|S|W|UP|DOWN>...`);
    }
    const body = {
      protocolVersion: 1,
      commandId: `cli-${randomUUID()}`,
      workerId: first,
      issuedAt: new Date().toISOString(),
      expiresAt: timestampAfterMinutes(10),
      budget: { maxPrimitives: steps.length, maxBlockChanges: 0 },
      skill: "navigate.path" as const,
      arguments: { steps },
    };
    console.log(JSON.stringify(await postOrPreview("/v1/commands", body, dryRun), null, 2));
    return;
  }
  if (command === "path-to") {
    const locationName = positionalArgs.slice(2).join(" ").trim();
    if (!first || !locationName) {
      throw new Error(`usage: ${cliName} path-to <worker-id> <location-name>`);
    }
    console.log(
      JSON.stringify(
        await request(
          `/v1/workers/${encodeURIComponent(first)}/path-to/${encodeURIComponent(locationName)}`,
        ),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "go-to") {
    const locationName = positionalArgs.slice(2).join(" ").trim();
    if (!first || !locationName) {
      throw new Error(`usage: ${cliName} go-to <worker-id> <location-name>`);
    }
    console.log(
      JSON.stringify(
        await request(
          `/v1/workers/${encodeURIComponent(first)}/path-to/${encodeURIComponent(locationName)}`,
          {
            method: "POST",
          },
        ),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "excavate") {
    const width = Number(args[2]);
    const height = Number(args[3]);
    const depth = Number(args[4]);
    if (
      !first ||
      ![width, height, depth].every((value) => Number.isInteger(value) && value >= 1 && value <= 64)
    ) {
      throw new Error(`usage: ${cliName} excavate <worker-id> <width> <height> <depth>`);
    }
    const body = {
      protocolVersion: 1,
      commandId: `cli-${randomUUID()}`,
      workerId: first,
      issuedAt: new Date().toISOString(),
      expiresAt: timestampAfterMinutes(10),
      budget: {
        maxPrimitives: Math.max(1, width * height * depth * 3),
        maxBlockChanges: width * height * depth,
      },
      skill: "mining.excavate" as const,
      arguments: { width, height, depth },
    };
    console.log(JSON.stringify(await postOrPreview("/v1/commands", body, dryRun), null, 2));
    return;
  }
  if (command === "deposit") {
    const positionals: string[] = [];
    for (let index = 2; index < args.length; index += 1) {
      const value = args[index];
      if (value === "--container-id" || value === "--item-key") {
        index += 1;
        continue;
      }
      if (value !== "--dry-run") positionals.push(value!);
    }
    const quantity = positionals[0] === undefined ? undefined : Number(positionals[0]);
    const slot = positionals[1] === undefined ? undefined : Number(positionals[1]);
    const containerId = flag(args, "--container-id");
    const itemKey = flag(args, "--item-key");
    if (
      !first ||
      (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1 || quantity > 64))
    ) {
      throw new Error(
        `usage: ${cliName} deposit <worker-id> [quantity] [slot] [--container-id <id>] [--item-key <id>]`,
      );
    }
    if (slot !== undefined && (!Number.isInteger(slot) || slot < 1 || slot > 16)) {
      throw new Error(
        `usage: ${cliName} deposit <worker-id> [quantity] [slot] [--container-id <id>] [--item-key <id>]`,
      );
    }
    if (containerId !== undefined && !IdentifierSchema.safeParse(containerId).success) {
      throw new Error(
        `usage: ${cliName} deposit <worker-id> [quantity] [slot] [--container-id <id>] [--item-key <id>]`,
      );
    }
    if (itemKey !== undefined && !IdentifierSchema.safeParse(normalizeItemKey(itemKey)).success) {
      throw new Error(
        `usage: ${cliName} deposit <worker-id> [quantity] [slot] [--container-id <id>] [--item-key <id>]`,
      );
    }
    const body = {
      protocolVersion: 1,
      commandId: `cli-${randomUUID()}`,
      workerId: first,
      issuedAt: new Date().toISOString(),
      expiresAt: timestampAfterMinutes(5),
      budget: { maxPrimitives: 1, maxBlockChanges: 0, maxInventoryTransfers: 1 },
      skill: "inventory.deposit" as const,
      arguments: {
        ...(containerId === undefined ? {} : { containerId }),
        ...(itemKey === undefined ? {} : { itemKey: normalizeItemKey(itemKey) }),
        ...(quantity === undefined ? {} : { quantity }),
        ...(slot === undefined ? {} : { slot }),
      },
    };
    console.log(JSON.stringify(await postOrPreview("/v1/commands", body, dryRun), null, 2));
    return;
  }
  if (command === "withdraw") {
    const quantity = args[3] === undefined ? undefined : Number(args[3]);
    const slot = args[4] === undefined ? undefined : Number(args[4]);
    const containerId = flag(args, "--container-id");
    if (
      !first ||
      !second ||
      quantity === undefined ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 64
    ) {
      throw new Error(
        `usage: ${cliName} withdraw <worker-id> <item-key> <quantity> [slot] [--container-id <id>]`,
      );
    }
    if (slot !== undefined && (!Number.isInteger(slot) || slot < 1 || slot > 16)) {
      throw new Error(
        `usage: ${cliName} withdraw <worker-id> <item-key> <quantity> [slot] [--container-id <id>]`,
      );
    }
    if (containerId !== undefined && !IdentifierSchema.safeParse(containerId).success) {
      throw new Error(
        `usage: ${cliName} withdraw <worker-id> <item-key> <quantity> [slot] [--container-id <id>]`,
      );
    }
    const body = {
      protocolVersion: 1,
      commandId: `cli-${randomUUID()}`,
      workerId: first,
      issuedAt: new Date().toISOString(),
      expiresAt: timestampAfterMinutes(5),
      budget: { maxPrimitives: 1, maxBlockChanges: 0, maxInventoryTransfers: 1 },
      skill: "inventory.withdraw" as const,
      arguments: {
        ...(containerId === undefined ? {} : { containerId }),
        itemKey: normalizeItemKey(second),
        quantity,
        ...(slot === undefined ? {} : { slot }),
      },
    };
    console.log(JSON.stringify(await postOrPreview("/v1/commands", body, dryRun), null, 2));
    return;
  }
  if (command === "gather") {
    const quantity = Number(args[3]);
    const maxDepth = Number(args[4]);
    if (
      !first ||
      !second ||
      ![quantity, maxDepth].every((value) => Number.isInteger(value) && value >= 1 && value <= 64)
    ) {
      throw new Error(`usage: ${cliName} gather <worker-id> <item-key> <quantity> <max-depth>`);
    }
    const body = {
      protocolVersion: 1,
      commandId: `cli-${randomUUID()}`,
      workerId: first,
      issuedAt: new Date().toISOString(),
      expiresAt: timestampAfterMinutes(10),
      budget: { maxPrimitives: maxDepth * 4, maxBlockChanges: maxDepth },
      skill: "mining.gather" as const,
      arguments: { itemKey: normalizeItemKey(second), quantity, maxDepth },
    };
    console.log(JSON.stringify(await postOrPreview("/v1/commands", body, dryRun), null, 2));
    return;
  }
  if (command === "stop") {
    if (!first) {
      throw new Error(`usage: ${cliName} stop <worker-id|all>`);
    }
    const body = {
      protocolVersion: 1,
      controlId: `cli-stop-${randomUUID()}`,
      issuedAt: new Date().toISOString(),
      ...(first === "all"
        ? { type: "all.stop" as const }
        : { type: "worker.stop" as const, workerId: first }),
      reason: "operator stop",
    };
    console.log(JSON.stringify(await postOrPreview("/v1/stop-controls", body, dryRun), null, 2));
    return;
  }
  if (command === "update") {
    const target = flag(args, "--target");
    const version = flag(args, "--version");
    if (!target || !version || !UpdateTargetSchema.safeParse(target).success) {
      throw new Error(
        `usage: ${cliName} update --target <gateway:id|worker:id|fleet:gateway-id> --version <vX.Y.Z>`,
      );
    }
    if (!ReleaseVersionSchema.safeParse(version).success) {
      throw new Error("version must be an immutable semver tag such as v0.2.0");
    }
    const request = UpdateRequestSchema.parse({
      protocolVersion: 1,
      updateId: `cli-update-${randomUUID()}`,
      target,
      releaseVersion: version,
      manifestUrl: flag(args, "--manifest-url") ?? manifestUrl(version),
      issuedAt: new Date().toISOString(),
      expiresAt: timestampAfterMinutes(30),
    });
    console.log(JSON.stringify(await postOrPreview("/v1/updates", request, dryRun), null, 2));
    return;
  }
  if (command === "update-status") {
    if (!first || second) {
      throw new Error(`usage: ${cliName} update-status <update-id>`);
    }
    console.log(JSON.stringify(await request(`/v1/updates/${encodeURIComponent(first)}`), null, 2));
    return;
  }
  throw new Error(`unknown command\n${usage()}`);
}

if (require.main === module) {
  void runCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown CLI failure";
    console.error(message);
    process.exitCode = 1;
  });
}
