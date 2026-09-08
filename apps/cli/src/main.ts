import { randomUUID } from "node:crypto";

import {
  DirectionSchema,
  ReleaseVersionSchema,
  UpdateRequestSchema,
  UpdateTargetSchema,
} from "@computercraft-agents/protocol";

export const cliName = "computercraft-agents" as const;

export function usage(): string {
  return [
    `${cliName} workers`,
    `${cliName} workers <worker-id>`,
    `${cliName} diagnose`,
    `${cliName} move <worker-id> <N|E|S|W|UP|DOWN>`,
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
