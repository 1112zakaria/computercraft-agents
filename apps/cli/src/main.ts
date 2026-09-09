import { randomUUID } from "node:crypto";

import {
  DirectionSchema,
  DirectWorkerProvisionSchema,
  ReleaseVersionSchema,
  UpdateRequestSchema,
  UpdateTargetSchema,
} from "@computercraft-agents/protocol";

export const cliName = "computercraft-agents" as const;

export function usage(): string {
  return [
    `${cliName} workers`,
    `${cliName} workers <worker-id>`,
    `${cliName} provision-worker --id <worker-id> --server <server-id> --computer-id <number> --version <version>`,
    `${cliName} diagnose`,
    `${cliName} move <worker-id> <N|E|S|W|UP|DOWN>`,
    `${cliName} excavate <worker-id> <width> <height> <depth>`,
    `${cliName} deposit <worker-id> [quantity] [slot]`,
    `${cliName} stop <worker-id|all>`,
    `${cliName} update --target <gateway:id|worker:id|fleet:gateway-id> --version <vX.Y.Z>`,
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

export async function runCli(args: readonly string[]): Promise<void> {
  const [command, first, second] = args.map((argument) => argument.trim());
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
    console.log(
      JSON.stringify(await request("/v1/commands", { method: "POST", body: JSON.stringify(body) })),
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
    console.log(
      JSON.stringify(await request("/v1/commands", { method: "POST", body: JSON.stringify(body) })),
    );
    return;
  }
  if (command === "deposit") {
    const quantity = args[2] === undefined ? undefined : Number(args[2]);
    const slot = args[3] === undefined ? undefined : Number(args[3]);
    if (
      !first ||
      (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1 || quantity > 64))
    ) {
      throw new Error(`usage: ${cliName} deposit <worker-id> [quantity] [slot]`);
    }
    if (slot !== undefined && (!Number.isInteger(slot) || slot < 1 || slot > 16)) {
      throw new Error(`usage: ${cliName} deposit <worker-id> [quantity] [slot]`);
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
        ...(quantity === undefined ? {} : { quantity }),
        ...(slot === undefined ? {} : { slot }),
      },
    };
    console.log(
      JSON.stringify(await request("/v1/commands", { method: "POST", body: JSON.stringify(body) })),
    );
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
    console.log(
      JSON.stringify(
        await request("/v1/stop-controls", { method: "POST", body: JSON.stringify(body) }),
      ),
    );
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
    console.log(JSON.stringify(await requestApi("/v1/updates", request), null, 2));
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

async function requestApi(path: string, body: unknown): Promise<unknown> {
  return request(path, { method: "POST", body: JSON.stringify(body) });
}

if (require.main === module) {
  void runCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown CLI failure";
    console.error(message);
    process.exitCode = 1;
  });
}
