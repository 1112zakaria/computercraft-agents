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
} from "@computercraft-agents/protocol";
import { RepositoryError } from "@computercraft-agents/database";
import type {
  DirectWorkerPollResult,
  GatewayPollResult,
  GatewayRuntimeRepository,
  GoalTaskRecord,
  UpdateRolloutRecord,
} from "@computercraft-agents/database";
import type { z } from "zod";

export interface GatewayServiceConfig {
  readonly bearerSecret: string;
  readonly adminSecret: string;
  readonly enabledSkills?: readonly SkillName[];
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
  listGateways(): Promise<readonly Record<string, unknown>[]>;
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

  public async diagnostics(): Promise<object> {
    const [gateways, workers] = await Promise.all([
      this.store.listGateways(),
      this.store.listWorkers(),
    ]);
    return {
      protocolVersion: 1,
      service: "ok",
      gatewayEndpoint: "/v1/gateway",
      gateways,
      workers,
    };
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

  public async dispatchRunnableTasks(): Promise<readonly Record<string, unknown>[]> {
    const [taskRows, workerRows] = await Promise.all([
      this.store.listRunnableTasks(),
      this.store.listWorkers(),
    ]);
    const tasks = taskRows.flatMap((row) => {
      const taskId = typeof row.taskId === "string" ? row.taskId : undefined;
      const skillName = typeof row.skillName === "string" ? row.skillName : undefined;
      if (!taskId || !skillName || !SkillNameSchema.safeParse(skillName).success) return [];
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
          currentTaskId: null,
        },
      ];
    });
    const assignments = selectDispatchableTasks(tasks, workers);
    const results: Record<string, unknown>[] = [];
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
    return results;
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
    const target = coordinateFromUnknown(location);
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
): GatewayService {
  return new GatewayService(repository, {
    bearerSecret,
    adminSecret,
    enabledSkills,
  });
}
