import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import {
  CommandPollResponseSchema,
  CommandSchema,
  DirectWorkerEventBatchSchema,
  DirectWorkerHeartbeatSchema,
  DirectWorkerPollResponseSchema,
  DirectWorkerProvisionSchema,
  DirectWorkerRegistrationResponseSchema,
  DirectWorkerRegistrationSchema,
  ErrorResponseSchema,
  EventAckSchema,
  GoalCreateRequestSchema,
  NamedLocationCreateRequestSchema,
  EventBatchSchema,
  GatewayHeartbeatSchema,
  GatewayRegistrationSchema,
  IdentifierSchema,
  SkillNameSchema,
  StopControlSchema,
  TaskDispatchRequestSchema,
  TaskTransitionRequestSchema,
  UpdateRequestSchema,
  WorkerAnchorRequestSchema,
} from "@computercraft-agents/protocol";
import { selectDispatchableTasks } from "@computercraft-agents/scheduler";
import { findKnownPath, SparseWorldModel, type Coordinate } from "@computercraft-agents/navigation";
import { parseAddressedGatherGoal } from "@computercraft-agents/domain";
import { assemblePlanningContext } from "@computercraft-agents/reasoning";
import type {
  CommandPollResponse,
  Command,
  DirectWorkerEventBatch,
  DirectWorkerHeartbeat,
  DirectWorkerRegistration,
  DirectWorkerProvision,
  EventAck,
  EventBatch,
  GatewayHeartbeat,
  GatewayRegistration,
  StopControl,
  SkillName,
  UpdateRequest,
  WorkerAnchorRequest,
} from "@computercraft-agents/protocol";
import { RepositoryError } from "@computercraft-agents/database";
import type {
  DirectWorkerPollResult,
  GatewayPollResult,
  GatewayRuntimeRepository,
  GoalTaskRecord,
  PlannerRuntimeStateRecord,
  PlannerTriggerRecord,
  UpdateRolloutRecord,
} from "@computercraft-agents/database";
import type { z } from "zod";

export interface GatewayServiceConfig {
  readonly bearerSecret: string;
  readonly adminSecret: string;
  readonly enabledSkills?: readonly SkillName[];
  readonly schedulerEnabled?: boolean;
}

type GatewayRegistrationPayload = Omit<GatewayRegistration, "capabilities"> & {
  readonly capabilities?: GatewayRegistration["capabilities"];
};

export interface GatewayServiceStore {
  register(payload: GatewayRegistrationPayload): Promise<unknown>;
  heartbeat(payload: GatewayHeartbeat): Promise<unknown>;
  poll(gatewayId: string, after: string | null): Promise<GatewayPollResult>;
  ingestEvents(batch: EventBatch): Promise<string[]>;
  enqueueCommand(command: Command): Promise<void>;
  enqueueStopControl(control: StopControl): Promise<void>;
  enqueueUpdate(request: UpdateRequest): Promise<UpdateRolloutRecord>;
  listUpdates(): Promise<readonly UpdateRolloutRecord[]>;
  getUpdate(updateId: string): Promise<UpdateRolloutRecord | undefined>;
  listWorkers(): Promise<readonly Record<string, unknown>[]>;
  getWorker(workerId: string): Promise<Record<string, unknown> | undefined>;
  anchorWorker(workerId: string, input: WorkerAnchorRequest): Promise<Record<string, unknown>>;
  listGateways(): Promise<readonly Record<string, unknown>[]>;
  listAuditEvents(limit: number): Promise<readonly Record<string, unknown>[]>;
  provisionDirectWorker(payload: DirectWorkerProvision): Promise<Record<string, unknown>>;
  registerDirectWorker(payload: DirectWorkerRegistration): Promise<{
    readonly workerId: string;
    readonly workerBootId: string;
  }>;
  heartbeatDirectWorker(payload: DirectWorkerHeartbeat): Promise<{
    readonly workerId: string;
    readonly workerBootId: string;
  }>;
  pollDirectWorker(workerId: string, after: string | null): Promise<DirectWorkerPollResult>;
  ingestDirectWorkerEvents(payload: DirectWorkerEventBatch): Promise<string[]>;
  createGoal(input: {
    readonly projectName: string;
    readonly createdByPrincipal: string;
    readonly goalText: string;
    readonly priority: number;
    readonly skillName: string;
    readonly arguments: unknown;
    readonly requiredCapabilities?: readonly string[];
  }): Promise<GoalTaskRecord>;
  listGoals(): Promise<readonly Record<string, unknown>[]>;
  listProjects(): Promise<readonly Record<string, unknown>[]>;
  listAgents(): Promise<readonly Record<string, unknown>[]>;
  getAgent(name: string): Promise<Record<string, unknown> | undefined>;
  listTasks(): Promise<readonly Record<string, unknown>[]>;
  getTask(taskId: string): Promise<Record<string, unknown> | undefined>;
  getGoalReport(taskId: string): Promise<Record<string, unknown> | undefined>;
  listPlannerTriggers(limit: number): Promise<readonly PlannerTriggerRecord[]>;
  getPlannerRuntimeState(): Promise<PlannerRuntimeStateRecord>;
  listRunnableTasks(): Promise<readonly Record<string, unknown>[]>;
  claimTask(taskId: string, workerKey: string): Promise<Record<string, unknown>>;
  dispatchTask(taskId: string, workerKey: string, commandId: string): Promise<Command>;
  transitionTask(taskId: string, nextState: string, reason?: string): Promise<void>;
  upsertNamedLocation(input: {
    readonly name: string;
    readonly dimension: number;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly facing?: string | null;
    readonly approach?: unknown;
    readonly source: string;
    readonly confidence: string;
    readonly metadata: unknown;
  }): Promise<Record<string, unknown>>;
  listNamedLocations(): Promise<readonly Record<string, unknown>[]>;
  resolveNamedLocation(name: string): Promise<Record<string, unknown> | undefined>;
  listWorldCells(): Promise<readonly Record<string, unknown>[]>;
}

export interface GatewayRequestContext {
  readonly gatewayId: string;
}

export interface WorkerRequestContext {
  readonly workerId: string;
}

export interface SchedulerTickResult {
  readonly dispatched: readonly Record<string, unknown>[];
  readonly skipped?: readonly Record<string, unknown>[];
}

interface GoalPreflightBlocker {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export class HttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function parseBearerSecret(value: string | undefined): string | undefined {
  if (!value?.startsWith("Bearer ")) {
    return undefined;
  }
  const token = value.slice("Bearer ".length).trim();
  return token || undefined;
}

function secretsEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (typeof entry === "object" && entry !== null && "name" in entry) {
      const name = (entry as { name?: unknown }).name;
      return typeof name === "string" ? [name] : [];
    }
    return [];
  });
}

function targetWorkerId(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("targetWorkerId" in value)) {
    return null;
  }
  const target = (value as { targetWorkerId?: unknown }).targetWorkerId;
  return typeof target === "string" && target.length > 0 ? target : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coordinateFromUnknown(value: unknown): Coordinate | undefined {
  if (!isRecord(value)) return undefined;
  const dimension = value.dimension;
  const x = value.x;
  const y = value.y;
  const z = value.z;
  if (
    typeof dimension !== "number" ||
    !Number.isInteger(dimension) ||
    typeof x !== "number" ||
    !Number.isInteger(x) ||
    typeof y !== "number" ||
    !Number.isInteger(y) ||
    typeof z !== "number" ||
    !Number.isInteger(z)
  ) {
    return undefined;
  }
  return { dimension, x, y, z };
}

export class GatewayService {
  public constructor(
    private readonly store: GatewayServiceStore,
    private readonly config: GatewayServiceConfig,
  ) {}

  public authenticate(headers: IncomingHttpHeaders): GatewayRequestContext {
    const gatewayId = headerValue(headers, "x-agent-gateway-id");
    const token = parseBearerSecret(headerValue(headers, "authorization"));
    if (!gatewayId || !IdentifierSchema.safeParse(gatewayId).success || !token) {
      throw new HttpError(401, "AUTHENTICATION_FAILED", "gateway authentication failed");
    }
    if (!secretsEqual(token, this.config.bearerSecret)) {
      throw new HttpError(401, "AUTHENTICATION_FAILED", "gateway authentication failed");
    }
    return { gatewayId };
  }

  public authenticateWorker(headers: IncomingHttpHeaders): WorkerRequestContext {
    const workerId = headerValue(headers, "x-agent-worker-id");
    const token = parseBearerSecret(headerValue(headers, "authorization"));
    if (!workerId || !IdentifierSchema.safeParse(workerId).success || !token) {
      throw new HttpError(401, "AUTHENTICATION_FAILED", "worker authentication failed");
    }
    if (!secretsEqual(token, this.config.bearerSecret)) {
      throw new HttpError(401, "AUTHENTICATION_FAILED", "worker authentication failed");
    }
    return { workerId };
  }

  public async register(context: GatewayRequestContext, input: unknown): Promise<object> {
    const payload = this.parsePayload(GatewayRegistrationSchema, input);
    this.assertGatewayMatches(context, payload.gatewayId);
    await this.store.register(payload);
    return {
      protocolVersion: 1,
      accepted: true,
      gatewayId: payload.gatewayId,
      bootId: payload.bootId,
    };
  }

  public async provisionDirectWorker(input: unknown): Promise<object> {
    const payload = this.parsePayload(DirectWorkerProvisionSchema, input);
    return this.store.provisionDirectWorker(payload);
  }

  public async registerDirectWorker(
    context: WorkerRequestContext,
    input: unknown,
  ): Promise<object> {
    const payload = this.parsePayload(DirectWorkerRegistrationSchema, input);
    this.assertWorkerMatches(context, payload.workerId);
    const result = await this.store.registerDirectWorker(payload);
    return DirectWorkerRegistrationResponseSchema.parse({
      protocolVersion: 1,
      accepted: true,
      workerId: result.workerId,
      workerBootId: result.workerBootId,
      serverTime: new Date().toISOString(),
      pollIntervalSeconds: 2,
    });
  }

  public async heartbeatDirectWorker(
    context: WorkerRequestContext,
    input: unknown,
  ): Promise<object> {
    const payload = this.parsePayload(DirectWorkerHeartbeatSchema, input);
    this.assertWorkerMatches(context, payload.workerId);
    const result = await this.store.heartbeatDirectWorker(payload);
    return {
      protocolVersion: 1,
      accepted: true,
      workerId: result.workerId,
      workerBootId: result.workerBootId,
      serverTime: new Date().toISOString(),
    };
  }

  public async pollDirectWorker(
    context: WorkerRequestContext,
    after: string | null,
  ): Promise<object> {
    if (after !== null && !IdentifierSchema.safeParse(after).success) {
      throw new HttpError(400, "INVALID_PAYLOAD", "after cursor is invalid");
    }
    const result = await this.store.pollDirectWorker(context.workerId, after);
    return DirectWorkerPollResponseSchema.parse({
      protocolVersion: 1,
      serverTime: new Date().toISOString(),
      commands: result.commands,
      stopControls: result.stopControls,
      updates: result.updates,
      nextCursor: result.nextCursor,
    });
  }

  public async directWorkerEvents(context: WorkerRequestContext, input: unknown): Promise<object> {
    const payload = this.parsePayload(DirectWorkerEventBatchSchema, input);
    this.assertWorkerMatches(context, payload.workerId);
    return {
      protocolVersion: 1,
      workerId: payload.workerId,
      workerBootId: payload.workerBootId,
      acceptedEventIds: await this.store.ingestDirectWorkerEvents(payload),
    };
  }

  public async heartbeat(context: GatewayRequestContext, input: unknown): Promise<object> {
    const payload = this.parsePayload(GatewayHeartbeatSchema, input);
    this.assertGatewayMatches(context, payload.gatewayId);
    await this.store.heartbeat(payload);
    return {
      protocolVersion: 1,
      accepted: true,
      gatewayId: payload.gatewayId,
      bootId: payload.bootId,
    };
  }

  public async poll(
    context: GatewayRequestContext,
    after: string | null,
  ): Promise<CommandPollResponse> {
    if (after !== null && !IdentifierSchema.safeParse(after).success) {
      throw new HttpError(400, "INVALID_PAYLOAD", "after cursor is invalid");
    }
    const result = await this.store.poll(context.gatewayId, after);
    return CommandPollResponseSchema.parse({
      protocolVersion: 1,
      serverTime: new Date().toISOString(),
      commands: result.commands,
      stopControls: result.stopControls,
      updates: result.updates,
      nextCursor: result.nextCursor,
    });
  }

  public async events(context: GatewayRequestContext, input: unknown): Promise<EventAck> {
    const payload = this.parsePayload(EventBatchSchema, input);
    this.assertGatewayMatches(context, payload.gatewayId);
    for (const event of payload.events) {
      if (event.gatewayId !== payload.gatewayId) {
        throw new HttpError(400, "INVALID_PAYLOAD", "event gateway identity does not match batch");
      }
    }
    const acceptedEventIds = await this.store.ingestEvents(payload);
    return EventAckSchema.parse({
      protocolVersion: 1,
      gatewayId: payload.gatewayId,
      bootId: payload.bootId,
      acceptedEventIds,
    });
  }

  public parseBody(input: string): unknown {
    if (!input.trim()) {
      throw new HttpError(400, "INVALID_PAYLOAD", "request body must be JSON");
    }
    try {
      return JSON.parse(input) as unknown;
    } catch {
      throw new HttpError(400, "INVALID_PAYLOAD", "request body must contain valid JSON");
    }
  }

  public health(): object {
    return { status: "ok", service: "computercraft-agents-control-plane" };
  }

  public authenticateAdmin(headers: IncomingHttpHeaders): void {
    const supplied = headerValue(headers, "x-control-plane-secret");
    if (!supplied || !secretsEqual(supplied, this.config.adminSecret)) {
      throw new HttpError(401, "AUTHENTICATION_FAILED", "control-plane authentication failed");
    }
  }

  public async listWorkers(): Promise<readonly Record<string, unknown>[]> {
    return this.store.listWorkers();
  }

  public async getWorker(workerId: string): Promise<Record<string, unknown>> {
    if (!IdentifierSchema.safeParse(workerId).success) {
      throw new HttpError(400, "INVALID_PAYLOAD", "worker id is invalid");
    }
    const worker = await this.store.getWorker(workerId);
    if (!worker) {
      throw new HttpError(404, "UNKNOWN_WORKER", "worker was not found");
    }
    return worker;
  }

  public async anchorWorker(workerId: string, input: unknown): Promise<Record<string, unknown>> {
    if (!IdentifierSchema.safeParse(workerId).success) {
      throw new HttpError(400, "INVALID_PAYLOAD", "worker id is invalid");
    }
    const request = this.parsePayload(WorkerAnchorRequestSchema, input);
    return this.store.anchorWorker(workerId, { ...request, source: request.source ?? "operator" });
  }

  public async diagnostics(): Promise<object> {
    const [gateways, workers] = await Promise.all([
      this.store.listGateways(),
      this.store.listWorkers(),
    ]);
    const onlineGateways = gateways.filter((gateway) => gateway.status === "ONLINE").length;
    const onlineWorkers = workers.filter((worker) => worker.online === true).length;
    const gatewayRuntimeVersions = [
      ...new Set(
        gateways.flatMap((gateway) =>
          typeof gateway.runtimeVersion === "string" ? [gateway.runtimeVersion] : [],
        ),
      ),
    ];
    const workerRuntimeVersions = [
      ...new Set(
        workers.flatMap((worker) =>
          typeof worker.runtimeVersion === "string" ? [worker.runtimeVersion] : [],
        ),
      ),
    ];
    return {
      protocolVersion: 1,
      service: "ok",
      checkedAt: new Date().toISOString(),
      gatewayEndpoint: "/v1/gateway",
      workerEndpoint: "/v1/worker",
      summary: {
        registeredGateways: gateways.length,
        onlineGateways,
        registeredWorkers: workers.length,
        onlineWorkers,
      },
      checks: {
        gatewayRegistration: {
          status: gateways.length > 0 ? "PASS" : "PENDING",
          detail:
            gateways.length > 0
              ? `${gateways.length} gateway(s) registered`
              : "no gateway has registered",
        },
        workerRegistration: {
          status: workers.length > 0 ? "PASS" : "PENDING",
          detail:
            workers.length > 0
              ? `${workers.length} worker(s) registered`
              : "no worker has registered",
        },
        onlineWorker: {
          status: onlineWorkers > 0 ? "PASS" : "PENDING",
          detail: onlineWorkers > 0 ? `${onlineWorkers} worker(s) online` : "no worker is online",
        },
        scheduler: {
          status: this.config.schedulerEnabled === true ? "PASS" : "MANUAL",
          detail:
            this.config.schedulerEnabled === true
              ? "background scheduler is enabled"
              : "background scheduler is disabled; use scheduler-tick or goal --start",
        },
      },
      scheduler: {
        enabled: this.config.schedulerEnabled === true,
        mode: this.config.schedulerEnabled === true ? "BACKGROUND" : "MANUAL",
      },
      runtimeVersions: {
        gateway: gatewayRuntimeVersions,
        worker: workerRuntimeVersions,
      },
      gateways,
      workers,
    };
  }

  public async listAuditEvents(input: string | null): Promise<readonly Record<string, unknown>[]> {
    const limit = input === null || input.trim() === "" ? 50 : Number(input);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new HttpError(
        400,
        "INVALID_PAYLOAD",
        "audit limit must be an integer between 1 and 200",
      );
    }
    return this.store.listAuditEvents(limit);
  }

  public listFeatureGates(): readonly Record<string, unknown>[] {
    const enabled = new Set(this.config.enabledSkills ?? SkillNameSchema.options);
    return SkillNameSchema.options.map((name) => ({ name, enabled: enabled.has(name) }));
  }

  public async enqueueCommand(input: unknown): Promise<object> {
    const command = this.parsePayload(CommandSchema, input);
    if (!(this.config.enabledSkills ?? SkillNameSchema.options).includes(command.skill)) {
      throw new HttpError(403, "CAPABILITY_NOT_ENABLED", `skill is disabled: ${command.skill}`);
    }
    await this.store.enqueueCommand(command);
    return { accepted: true, commandId: command.commandId };
  }

  public async createGoal(input: unknown): Promise<GoalTaskRecord> {
    const request = this.parsePayload(GoalCreateRequestSchema, input);
    const parsed = parseAddressedGatherGoal(request.goalText);
    if (!parsed.ok) {
      throw new HttpError(400, "INVALID_PAYLOAD", parsed.error);
    }
    return this.store.createGoal({
      projectName: `goal-${Date.now()}`,
      createdByPrincipal: request.createdByPrincipal,
      goalText: request.goalText,
      priority: request.priority ?? 0,
      skillName: "resource.gather",
      arguments: parsed.goal,
      requiredCapabilities: ["mining.gather", "navigate.path", "inventory.deposit"],
    });
  }

  /**
   * Check the control-plane prerequisites for the first useful gather goal
   * without creating a project, task, command, or world mutation.
   *
   * This is deliberately conservative: an operator-confirmed anchor and a
   * completely known walkable route are required before the scheduler is
   * allowed to dispatch the goal. Local turtle configuration (for example the
   * physical side of a named chest) remains an explicit operator advisory.
   */
  public async preflightGoal(input: unknown): Promise<Record<string, unknown>> {
    const request = this.parsePayload(GoalCreateRequestSchema, input);
    const parsed = parseAddressedGatherGoal(request.goalText);
    if (!parsed.ok) {
      throw new HttpError(400, "INVALID_PAYLOAD", parsed.error);
    }

    const goal = parsed.goal;
    const requiredCapabilities = ["mining.gather", "navigate.path", "inventory.deposit"];
    const blockers: GoalPreflightBlocker[] = [];
    const enabledSkills = new Set(this.config.enabledSkills ?? SkillNameSchema.options);
    const disabledSkills = requiredCapabilities.filter(
      (skill) => !enabledSkills.has(skill as SkillName),
    );
    if (disabledSkills.length > 0) {
      blockers.push({
        code: "SKILLS_DISABLED",
        message: "one or more skills required by the gather workflow are disabled",
        details: { skills: disabledSkills },
      });
    }

    const worker = await this.store.getWorker(goal.targetWorkerId);
    let start: Coordinate | undefined;
    let target: Coordinate | undefined;
    let path: Record<string, unknown> = { status: "NOT_CHECKED" };

    if (!worker) {
      blockers.push({
        code: "UNKNOWN_WORKER",
        message: "the addressed worker is not provisioned",
        details: { workerId: goal.targetWorkerId },
      });
    } else {
      if (worker.online !== true) {
        blockers.push({
          code: "WORKER_OFFLINE",
          message: "the addressed worker is not online",
          details: {
            workerId: goal.targetWorkerId,
            remediation: "Start or reboot the turtle and wait for its next heartbeat",
          },
        });
      }
      if (typeof worker.currentTaskId === "string" && worker.currentTaskId.length > 0) {
        blockers.push({
          code: "WORKER_BUSY",
          message: "the addressed worker already has an active task",
          details: {
            currentTaskId: worker.currentTaskId,
            remediation: "Wait for the current task to finish or explicitly pause/cancel it",
          },
        });
      }
      const capabilities = stringList(worker.capabilities);
      const missingCapabilities = requiredCapabilities.filter(
        (capability) => !capabilities.includes(capability),
      );
      if (missingCapabilities.length > 0) {
        blockers.push({
          code: "MISSING_CAPABILITIES",
          message: "the worker does not advertise all gather workflow capabilities",
          details: {
            missingCapabilities,
            remediation:
              "On the turtle, run lua enable-gather.lua, then run startup so it re-registers its capabilities",
          },
        });
      }

      const observation = isRecord(worker.observation) ? worker.observation : undefined;
      const position =
        observation && isRecord(observation.position) ? observation.position : undefined;
      start = coordinateFromUnknown(position);
      if (!start) {
        blockers.push({
          code: "POSITION_UNKNOWN",
          message: "the worker has no complete observed position",
          details: {
            remediation: `Stand the turtle at a verified coordinate, then run npm run cli -- anchor ${goal.targetWorkerId} <dimension> <x> <y> <z> [N|E|S|W]`,
          },
        });
      } else if (position?.confidence !== "CONFIRMED_ANCHOR") {
        blockers.push({
          code: "POSITION_NOT_CONFIRMED",
          message: "the worker position must be confirmed with the operator anchor command",
          details: {
            confidence: position?.confidence ?? null,
            remediation: `Run npm run cli -- anchor ${goal.targetWorkerId} ${start.dimension} ${start.x} ${start.y} ${start.z} [N|E|S|W] after verifying the turtle's physical position`,
          },
        });
      }
    }

    const destination = await this.store.resolveNamedLocation(goal.destination);
    if (!destination) {
      blockers.push({
        code: "UNKNOWN_LOCATION",
        message: "the destination is not a known named location",
        details: {
          destination: goal.destination,
          remediation: `Run npm run cli -- set-location "${goal.destination}" <dimension> <x> <y> <z> [N|E|S|W] --approach <dimension> <x> <y> <z> [N|E|S|W]`,
        },
      });
    } else {
      const approach = destination.approach;
      target = coordinateFromUnknown(approach) ?? coordinateFromUnknown(destination);
      if (!target) {
        blockers.push({
          code: "LOCATION_INCOMPLETE",
          message: "the named destination has no complete coordinate",
          details: {
            destination: goal.destination,
            remediation: `Update the destination with npm run cli -- set-location "${goal.destination}" <dimension> <x> <y> <z> [N|E|S|W]`,
          },
        });
      } else if (start && target.dimension !== start.dimension) {
        blockers.push({
          code: "DIMENSION_MISMATCH",
          message: "the worker and destination are in different dimensions",
          details: {
            workerDimension: start.dimension,
            destinationDimension: target.dimension,
            remediation: "Re-anchor the worker or correct the named location's dimension",
          },
        });
      }
    }

    if (start && target && start.dimension === target.dimension) {
      let planned: ReturnType<typeof findKnownPath>;
      if (start.x === target.x && start.y === target.y && start.z === target.z) {
        planned = { directions: [], coordinates: [start], expandedNodes: 0 };
      } else {
        const world = new SparseWorldModel();
        for (const cell of await this.store.listWorldCells()) {
          const coordinate = coordinateFromUnknown(cell);
          if (!coordinate || typeof cell.walkable !== "boolean") continue;
          world.setCell({
            ...coordinate,
            walkable: cell.walkable,
            observedAt: String(cell.observedAt ?? ""),
            source: String(cell.sourceWorkerId ?? "unknown"),
          });
        }
        planned = findKnownPath(world, start, target, { maxNodes: 10_000 });
      }
      if (!planned) {
        blockers.push({
          code: "PATH_NOT_KNOWN",
          message: "no completely known walkable path exists to the destination",
          details: {
            remediation: `Use bounded observations such as npm run cli -- observe ${goal.targetWorkerId} front, then rerun goal-preflight`,
          },
        });
        path = { status: "NOT_KNOWN" };
      } else {
        path = {
          status: "KNOWN",
          stepCount: planned.directions.length,
          directions: planned.directions,
          expandedNodes: planned.expandedNodes,
        };
      }
    }

    const destinationId =
      typeof destination?.name === "string"
        ? destination.name
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
        : undefined;
    return {
      protocolVersion: 1,
      ready: blockers.length === 0,
      goal,
      requiredCapabilities,
      blockers,
      advisories: destinationId
        ? [
            {
              code: "LOCAL_CONTAINER_CONFIGURATION",
              message: `confirm worker.conf maps container ID ${destinationId} to the physical chest side`,
              containerId: destinationId,
            },
          ]
        : [],
      worker: worker
        ? {
            workerId: worker.workerId,
            online: worker.online === true,
            transport: worker.transport ?? null,
            capabilities: stringList(worker.capabilities),
            currentTaskId: worker.currentTaskId ?? null,
            position: start ?? null,
          }
        : null,
      destination: destination
        ? {
            name: destination.name ?? goal.destination,
            position: target ?? null,
            confidence: destination.confidence ?? null,
          }
        : null,
      path,
    };
  }

  public async listGoals(): Promise<readonly Record<string, unknown>[]> {
    return this.store.listGoals();
  }

  public async listProjects(): Promise<readonly Record<string, unknown>[]> {
    return this.store.listProjects();
  }

  public async listAgents(): Promise<readonly Record<string, unknown>[]> {
    return this.store.listAgents();
  }

  public async getAgent(name: string): Promise<Record<string, unknown>> {
    const normalized = name.trim();
    if (!IdentifierSchema.safeParse(normalized).success) {
      throw new HttpError(400, "INVALID_PAYLOAD", "agent name is invalid");
    }
    const agent = await this.store.getAgent(normalized);
    if (!agent) {
      throw new HttpError(404, "UNKNOWN_AGENT", "agent was not found");
    }
    return agent;
  }

  public async listTasks(): Promise<readonly Record<string, unknown>[]> {
    return this.store.listTasks();
  }

  public async getTask(taskId: string): Promise<Record<string, unknown>> {
    if (!IdentifierSchema.safeParse(taskId).success) {
      throw new HttpError(400, "INVALID_PAYLOAD", "task id is invalid");
    }
    const task = await this.store.getTask(taskId);
    if (!task) {
      throw new HttpError(404, "UNKNOWN_TASK", "task was not found");
    }
    return task;
  }

  public async goalReport(taskId: string): Promise<Record<string, unknown>> {
    if (!IdentifierSchema.safeParse(taskId).success) {
      throw new HttpError(400, "INVALID_PAYLOAD", "task id is invalid");
    }
    const report = await this.store.getGoalReport(taskId);
    if (!report) {
      throw new HttpError(404, "UNKNOWN_TASK", "task was not found");
    }
    return report;
  }

  public async listPlannerTriggers(limit: number): Promise<readonly PlannerTriggerRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new HttpError(
        400,
        "INVALID_PAYLOAD",
        "planner trigger limit must be an integer between 1 and 200",
      );
    }
    return this.store.listPlannerTriggers(limit);
  }

  public async plannerStatus(): Promise<PlannerRuntimeStateRecord> {
    return this.store.getPlannerRuntimeState();
  }

  public async planningContext(taskId: string): Promise<Record<string, unknown>> {
    if (!IdentifierSchema.safeParse(taskId).success) {
      throw new HttpError(400, "INVALID_PAYLOAD", "task id is invalid");
    }
    const task = (await this.store.listTasks()).find((row) => row.taskId === taskId);
    if (!task) {
      throw new HttpError(404, "UNKNOWN_TASK", "task was not found");
    }
    const argumentsValue = isRecord(task.arguments) ? task.arguments : {};
    const workerId =
      typeof task.assignedWorkerId === "string"
        ? task.assignedWorkerId
        : typeof argumentsValue.targetWorkerId === "string"
          ? argumentsValue.targetWorkerId
          : undefined;
    const worker = workerId ? await this.store.getWorker(workerId) : undefined;
    const assembled = assemblePlanningContext({
      goalText: typeof task.goalText === "string" ? task.goalText : String(task.skillName ?? ""),
      task,
      worker: worker ?? null,
      skills: stringList(task.requiredCapabilities),
      worldKnowledge: await this.store.listWorldCells(),
      memories: [],
      recentConversation: [],
    });
    return { taskId, workerId: workerId ?? null, ...assembled };
  }

  public async listRunnableTasks(): Promise<readonly Record<string, unknown>[]> {
    return this.store.listRunnableTasks();
  }

  public async dispatchRunnableTasks(): Promise<SchedulerTickResult> {
    const [taskRows, workerRows] = await Promise.all([
      this.store.listRunnableTasks(),
      this.store.listWorkers(),
    ]);
    const skipped: Record<string, unknown>[] = [];
    const tasks = taskRows.flatMap((row) => {
      const taskId = typeof row.taskId === "string" ? row.taskId : undefined;
      const skillName = typeof row.skillName === "string" ? row.skillName : undefined;
      if (!taskId || !skillName || !SkillNameSchema.safeParse(skillName).success) return [];
      if (
        !(this.config.enabledSkills ?? SkillNameSchema.options).includes(skillName as SkillName)
      ) {
        skipped.push({
          taskId,
          status: "SKIPPED",
          reason: "SKILL_DISABLED",
          skillName,
        });
        return [];
      }
      return [
        {
          taskId,
          state: "READY" as const,
          priority: typeof row.priority === "number" ? row.priority : 0,
          requiredCapabilities: stringList(row.requiredCapabilities),
          targetWorkerId: targetWorkerId(row.arguments),
          assignedWorkerId: null,
        },
      ];
    });
    const workers = workerRows.flatMap((row) => {
      const workerId = typeof row.workerId === "string" ? row.workerId : undefined;
      if (!workerId) return [];
      return [
        {
          workerId,
          online: row.online === true,
          capabilities: stringList(row.capabilities),
          currentTaskId: typeof row.currentTaskId === "string" ? row.currentTaskId : null,
        },
      ];
    });
    const assignments = selectDispatchableTasks(tasks, workers);
    const results: Record<string, unknown>[] = [];
    const assignedTaskIds = new Set(assignments.map((assignment) => assignment.taskId));
    for (const task of tasks) {
      if (assignedTaskIds.has(task.taskId)) continue;
      const candidates = workers.filter(
        (worker) => !task.targetWorkerId || worker.workerId === task.targetWorkerId,
      );
      let reason = "WORKER_ALREADY_SELECTED";
      const details: Record<string, unknown> = {};
      if (candidates.length === 0) {
        reason = task.targetWorkerId ? "TARGET_WORKER_NOT_FOUND" : "NO_WORKER";
      } else {
        const online = candidates.filter((worker) => worker.online);
        if (online.length === 0) {
          reason = "WORKER_OFFLINE";
        } else {
          const idle = online.filter((worker) => !worker.currentTaskId);
          if (idle.length === 0) {
            reason = "WORKER_BUSY";
          } else {
            const missingCapabilities = [
              ...new Set(
                idle.flatMap((worker) =>
                  task.requiredCapabilities.filter(
                    (capability) => !worker.capabilities.includes(capability),
                  ),
                ),
              ),
            ];
            if (missingCapabilities.length > 0) {
              reason = "MISSING_CAPABILITIES";
              details.missingCapabilities = missingCapabilities;
            }
          }
        }
      }
      skipped.push({ taskId: task.taskId, status: "SKIPPED", reason, ...details });
    }
    for (const assignment of assignments) {
      try {
        const command = await this.store.dispatchTask(
          assignment.taskId,
          assignment.workerId,
          `scheduler-${randomUUID()}`,
        );
        results.push({
          taskId: assignment.taskId,
          workerId: assignment.workerId,
          status: "DISPATCHED",
          commandId: command.commandId,
        });
      } catch (error) {
        const failure = repositoryErrorToHttp(error);
        results.push({
          taskId: assignment.taskId,
          workerId: assignment.workerId,
          status: "FAILED",
          reason: failure.message,
        });
      }
    }
    return skipped.length > 0 ? { dispatched: results, skipped } : { dispatched: results };
  }

  public async claimTask(taskId: string, input: unknown): Promise<Record<string, unknown>> {
    if (!IdentifierSchema.safeParse(taskId).success) {
      throw new HttpError(400, "INVALID_PAYLOAD", "task id is invalid");
    }
    if (typeof input !== "object" || input === null || !("workerId" in input)) {
      throw new HttpError(400, "INVALID_PAYLOAD", "workerId is required");
    }
    const workerId = (input as { workerId?: unknown }).workerId;
    if (typeof workerId !== "string" || !IdentifierSchema.safeParse(workerId).success) {
      throw new HttpError(400, "INVALID_PAYLOAD", "workerId is invalid");
    }
    return this.store.claimTask(taskId, workerId);
  }

  public async transitionTask(taskId: string, input: unknown): Promise<object> {
    if (!IdentifierSchema.safeParse(taskId).success) {
      throw new HttpError(400, "INVALID_PAYLOAD", "task id is invalid");
    }
    const request = this.parsePayload(TaskTransitionRequestSchema, input);
    await this.store.transitionTask(taskId, request.status, request.reason);
    return { accepted: true, taskId, status: request.status, reason: request.reason ?? null };
  }

  public async dispatchTask(taskId: string, input: unknown): Promise<object> {
    if (!IdentifierSchema.safeParse(taskId).success) {
      throw new HttpError(400, "INVALID_PAYLOAD", "task id is invalid");
    }
    const request = this.parsePayload(TaskDispatchRequestSchema, input);
    const task = await this.store.getTask(taskId);
    const skillName = task?.skillName;
    if (
      typeof skillName === "string" &&
      SkillNameSchema.safeParse(skillName).success &&
      !(this.config.enabledSkills ?? SkillNameSchema.options).includes(skillName as SkillName)
    ) {
      throw new HttpError(403, "CAPABILITY_NOT_ENABLED", `skill is disabled: ${skillName}`);
    }
    const command = await this.store.dispatchTask(taskId, request.workerId, `task-${randomUUID()}`);
    return { accepted: true, taskId, workerId: request.workerId, command };
  }

  public async createNamedLocation(input: unknown): Promise<Record<string, unknown>> {
    const request = this.parsePayload(NamedLocationCreateRequestSchema, input);
    return this.store.upsertNamedLocation({ ...request, metadata: request.metadata ?? {} });
  }

  public async listNamedLocations(): Promise<readonly Record<string, unknown>[]> {
    return this.store.listNamedLocations();
  }

  public async resolveNamedLocation(name: string): Promise<Record<string, unknown>> {
    const normalized = name.trim();
    if (!normalized) {
      throw new HttpError(400, "INVALID_PAYLOAD", "location name must not be empty");
    }
    if (normalized.length > 256) {
      throw new HttpError(400, "INVALID_PAYLOAD", "location name is too long");
    }
    const location = await this.store.resolveNamedLocation(normalized);
    if (!location) {
      throw new HttpError(404, "UNKNOWN_LOCATION", "named location was not found");
    }
    return location;
  }

  public async planPathToLocation(
    workerId: string,
    locationName: string,
  ): Promise<Record<string, unknown>> {
    if (!IdentifierSchema.safeParse(workerId).success) {
      throw new HttpError(400, "INVALID_PAYLOAD", "worker id is invalid");
    }
    const location = await this.resolveNamedLocation(locationName);
    const worker = await this.store.getWorker(workerId);
    if (!worker) {
      throw new HttpError(404, "UNKNOWN_WORKER", "worker was not found");
    }
    const observation = worker.observation;
    if (!isRecord(observation) || !isRecord(observation.position)) {
      throw new HttpError(409, "POSITION_UNKNOWN", "worker has no known position");
    }
    const start = coordinateFromUnknown(observation.position);
    const target = coordinateFromUnknown(location.approach) ?? coordinateFromUnknown(location);
    if (!start || !target) {
      throw new HttpError(409, "POSITION_UNKNOWN", "worker or location position is incomplete");
    }
    if (start.dimension !== target.dimension) {
      throw new HttpError(409, "PATH_NOT_FOUND", "worker and location are in different dimensions");
    }

    const world = new SparseWorldModel();
    for (const cell of await this.store.listWorldCells()) {
      const coordinate = coordinateFromUnknown(cell);
      if (!coordinate || typeof cell.walkable !== "boolean") continue;
      world.setCell({
        ...coordinate,
        walkable: cell.walkable,
        observedAt: String(cell.observedAt ?? ""),
        source: String(cell.sourceWorkerId ?? "unknown"),
      });
    }
    const path = findKnownPath(world, start, target, { maxNodes: 10_000 });
    if (!path) {
      throw new HttpError(409, "PATH_NOT_FOUND", "no path exists through known walkable cells");
    }
    return {
      workerId,
      location,
      start,
      target,
      directions: path.directions,
      coordinates: path.coordinates,
      expandedNodes: path.expandedNodes,
    };
  }

  public async executePathToLocation(
    workerId: string,
    locationName: string,
  ): Promise<Record<string, unknown>> {
    const plan = await this.planPathToLocation(workerId, locationName);
    const directions = plan.directions;
    if (!Array.isArray(directions) || directions.length === 0) {
      return { accepted: true, status: "ALREADY_AT_LOCATION", plan };
    }
    if (directions.length > 1024) {
      throw new HttpError(409, "PATH_TOO_LONG", "planned path exceeds the command step limit");
    }
    const command = CommandSchema.parse({
      protocolVersion: 1,
      commandId: `path-${randomUUID()}`,
      workerId,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      budget: { maxPrimitives: directions.length, maxBlockChanges: 0 },
      skill: "navigate.path",
      arguments: { steps: directions },
    });
    await this.store.enqueueCommand(command);
    return { accepted: true, status: "QUEUED", command, plan };
  }

  public async listWorldCells(): Promise<readonly Record<string, unknown>[]> {
    return this.store.listWorldCells();
  }

  public async enqueueStopControl(input: unknown): Promise<object> {
    const control = this.parsePayload(StopControlSchema, input);
    await this.store.enqueueStopControl(control);
    return { accepted: true, controlId: control.controlId };
  }

  public async enqueueUpdate(input: unknown): Promise<UpdateRolloutRecord> {
    const request = this.parsePayload(UpdateRequestSchema, input);
    const manifestPath = new URL(request.manifestUrl).pathname;
    if (!manifestPath.includes(`/releases/download/${request.releaseVersion}/`)) {
      throw new HttpError(
        400,
        "INVALID_PAYLOAD",
        "manifestUrl must reference the requested immutable GitHub release tag",
      );
    }
    return this.store.enqueueUpdate(request);
  }

  public async listUpdates(): Promise<readonly UpdateRolloutRecord[]> {
    return this.store.listUpdates();
  }

  public async getUpdate(updateId: string): Promise<UpdateRolloutRecord> {
    if (!IdentifierSchema.safeParse(updateId).success) {
      throw new HttpError(400, "INVALID_PAYLOAD", "update id is invalid");
    }
    const update = await this.store.getUpdate(updateId);
    if (!update) {
      throw new HttpError(404, "UNKNOWN_UPDATE", "update was not found");
    }
    return update;
  }

  private parsePayload<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new HttpError(400, "INVALID_PAYLOAD", "request payload failed validation", false, {
        issues: result.error.issues,
      });
    }
    return result.data;
  }

  private assertGatewayMatches(context: GatewayRequestContext, payloadGatewayId: string): void {
    if (context.gatewayId !== payloadGatewayId) {
      throw new HttpError(
        401,
        "AUTHENTICATION_FAILED",
        "gateway identity does not match request payload",
      );
    }
  }

  private assertWorkerMatches(context: WorkerRequestContext, payloadWorkerId: string): void {
    if (context.workerId !== payloadWorkerId) {
      throw new HttpError(401, "AUTHENTICATION_FAILED", "worker identity does not match request");
    }
  }
}

export function repositoryErrorToHttp(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof RepositoryError) {
    const protocolCode =
      error.code === "UNKNOWN_WORKER"
        ? "UNKNOWN_WORKER"
        : error.code === "UNKNOWN_UPDATE"
          ? "UNKNOWN_UPDATE"
          : error.code === "STALE_WORKER_BOOT"
            ? "INVALID_PAYLOAD"
            : error.code === "INVALID_TARGET"
              ? "INVALID_PAYLOAD"
              : error.code === "WORKER_BOUND_ELSEWHERE"
                ? "INVALID_PAYLOAD"
                : error.code === "STALE_GATEWAY_BOOT"
                  ? "INVALID_PAYLOAD"
                  : error.code === "UPDATE_OVERLAP" || error.code === "UPDATE_ID_REUSE"
                    ? "INVALID_PAYLOAD"
                    : error.code === "CAPABILITY_NOT_ENABLED"
                      ? "CAPABILITY_NOT_ENABLED"
                      : error.code === "WORKER_OFFLINE" ||
                          error.code === "WORKER_BUSY" ||
                          error.code === "TASK_NOT_RUNNABLE" ||
                          error.code === "INVALID_TASK_TRANSITION"
                        ? "INVALID_PAYLOAD"
                        : "INTERNAL_ERROR";
    return new HttpError(error.statusCode, protocolCode, error.message, error.statusCode >= 500);
  }
  return new HttpError(500, "INTERNAL_ERROR", "internal control-plane error", true);
}

export function errorResponse(error: HttpError): object {
  return ErrorResponseSchema.parse({
    protocolVersion: 1,
    requestId: null,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details,
    },
  });
}

export function createRepositoryService(
  repository: GatewayRuntimeRepository,
  bearerSecret: string,
  adminSecret: string,
  enabledSkills?: readonly SkillName[],
  schedulerEnabled = false,
): GatewayService {
  return new GatewayService(repository, {
    bearerSecret,
    adminSecret,
    enabledSkills,
    schedulerEnabled,
  });
}
