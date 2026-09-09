import { randomUUID } from "node:crypto";

import type {
  Command,
  DirectUpdateControl,
  DirectWorkerEventBatch,
  DirectWorkerHeartbeat,
  DirectWorkerProvision,
  DirectWorkerRegistration,
  Event,
  EventBatch,
  GatewayHeartbeat,
  GatewayRegistration,
  StopControl,
  UpdateControl,
  UpdateRequest,
  UpdateStatus,
  WorkerAnchorRequest,
  WorkerTransport,
} from "@computercraft-agents/protocol";
import { CommandSchema, SkillNameSchema } from "@computercraft-agents/protocol";
import { findKnownPath, SparseWorldModel, type Coordinate } from "@computercraft-agents/navigation";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { effectivePositionConfidence, storedPositionConfidence } from "./position-confidence";

export interface GatewayRuntimeConfig {
  readonly gatewayTimeoutSeconds: number;
  readonly workerTimeoutSeconds: number;
  readonly worldCellMaxAgeSeconds: number;
}

export interface GatewayPollResult {
  readonly commands: readonly Command[];
  readonly stopControls: readonly StopControl[];
  readonly updates: readonly UpdateControl[];
  readonly nextCursor: string | null;
}

export interface DirectWorkerPollResult {
  readonly commands: readonly Command[];
  readonly stopControls: readonly StopControl[];
  readonly updates: readonly DirectUpdateControl[];
  readonly nextCursor: string | null;
}

export interface UpdateRolloutRecord extends UpdateRequest {
  readonly status: UpdateStatus;
  readonly gatewayId: string | null;
  readonly workerIds: string[];
  readonly transport: WorkerTransport;
  readonly failureCode?: string | null;
  readonly failureMessage?: string | null;
  readonly startedAt?: Date | string | null;
  readonly completedAt?: Date | string | null;
  readonly createdAt?: Date | string;
}

export interface GatewayIdentity {
  readonly gatewayId: string;
  readonly bootId: string;
}

export interface GoalTaskRecord {
  readonly projectId: string;
  readonly jobId: string;
  readonly taskId: string;
  readonly goalText: string;
  readonly status: string;
  readonly skillName: string;
  readonly arguments: unknown;
}

export interface PlannerTaskProposalInput {
  readonly skillName: string;
  readonly arguments: Record<string, unknown>;
  readonly requiredCapabilities: readonly string[];
  readonly priority: number;
}

export interface PlannerTriggerRecord {
  readonly triggerId: string;
  readonly cause: string;
  readonly subjectId: string;
  readonly occurredAt: string;
  readonly priority: number;
  readonly status: string;
  readonly attempts: number;
  readonly claimedAt?: string | null;
  readonly lastError?: unknown;
  readonly createdAt: string;
  readonly processedAt?: string | null;
}

export type PlannerTriggerStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED";

export type PlannerRuntimeState = "AVAILABLE" | "DEGRADED" | "PAUSED";

export interface PlannerRuntimeStateRecord {
  readonly state: PlannerRuntimeState;
  readonly consecutiveFailures: number;
  readonly lastFailureAt: string | null;
  readonly retryAfter: string | null;
  readonly updatedAt: string;
}

export interface CreateGoalInput {
  readonly projectName: string;
  readonly createdByPrincipal: string;
  readonly goalText: string;
  readonly priority: number;
  readonly skillName: string;
  readonly arguments: unknown;
  readonly requiredCapabilities?: readonly string[];
}

export interface NamedLocationInput {
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
}

interface GatewayRow extends QueryResultRow {
  id: string;
  gateway_key: string;
  boot_id: string;
}

interface WorkerRow extends QueryResultRow {
  id: string;
  worker_key: string;
  gateway_id: string | null;
  computer_id: number;
  transport_type: WorkerTransport;
  minecraft_server_id: string;
  boot_id: string | null;
}

interface CursorRow extends QueryResultRow {
  id: string;
  delivery_cursor: string;
  payload_json: Command | StopControl;
}

interface UpdateRow extends QueryResultRow {
  update_id: string;
  target: string;
  target_type: "gateway" | "worker" | "fleet";
  target_key: string;
  gateway_key: string | null;
  transport_type: WorkerTransport;
  release_version: string;
  manifest_url: string;
  issued_at: Date;
  expires_at: Date;
  status: UpdateStatus;
  failure_code: string | null;
  failure_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  delivery_cursor: string;
}

interface IdRow extends QueryResultRow {
  id: string;
}

function asJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: unknown): T {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function inventorySlotsFromCommandEvent(event: Event): readonly unknown[] | undefined {
  if (event.type !== "command.completed" || !isRecord(event.payload)) return undefined;
  const payload = event.payload as { readonly result?: unknown };
  const result = payload.result;
  if (!isRecord(result) || !isRecord(result.inventory)) return undefined;
  return Array.isArray(result.inventory.slots) ? result.inventory.slots : undefined;
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

function movedCoordinate(
  position: Coordinate & { readonly facing?: string },
  direction: string,
): Coordinate | undefined {
  if (direction === "UP") return { ...position, y: position.y + 1 };
  if (direction === "DOWN") return { ...position, y: position.y - 1 };
  if (direction === "N") return { ...position, z: position.z - 1 };
  if (direction === "E") return { ...position, x: position.x + 1 };
  if (direction === "S") return { ...position, z: position.z + 1 };
  if (direction === "W") return { ...position, x: position.x - 1 };
  return undefined;
}

function normalizeContainerId(value: string): string | undefined {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
  return normalized || undefined;
}

function commandArguments(value: Record<string, unknown>): Record<string, unknown> {
  const {
    targetWorkerId: _targetWorkerId,
    _plannerTriggerId: _plannerTriggerId,
    _plannerIndex: _plannerIndex,
    _plannerPriority: _plannerPriority,
    ...argumentsWithoutRouting
  } = value;
  return argumentsWithoutRouting;
}

function capabilityNames(value: unknown): string[] {
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

function integerArgument(
  argumentsJson: Record<string, unknown>,
  name: string,
  fallback: number,
): number {
  const value = argumentsJson[name];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
}

function commandBudget(skill: string, argumentsJson: Record<string, unknown>) {
  switch (skill) {
    case "navigate.path": {
      const steps = argumentsJson.steps;
      const count = Array.isArray(steps) ? steps.length : 1;
      return { maxPrimitives: Math.max(1, count), maxBlockChanges: 0 };
    }
    case "mining.excavate": {
      const width = integerArgument(argumentsJson, "width", 1);
      const height = integerArgument(argumentsJson, "height", 1);
      const depth = integerArgument(argumentsJson, "depth", 1);
      const blocks = Math.max(1, width * height * depth);
      return { maxPrimitives: Math.max(1, blocks * 3), maxBlockChanges: blocks };
    }
    case "mining.gather": {
      const depth = integerArgument(argumentsJson, "maxDepth", 1);
      return { maxPrimitives: Math.max(1, depth * 4), maxBlockChanges: depth };
    }
    case "inventory.deposit":
    case "inventory.withdraw":
      return { maxPrimitives: 1, maxBlockChanges: 0, maxInventoryTransfers: 1 };
    default:
      return { maxPrimitives: 1, maxBlockChanges: 0 };
  }
}

function commandStatusForEvent(type: Event["type"]): string | undefined {
  switch (type) {
    case "command.accepted":
      return "DELIVERED";
    case "command.started":
      return "RUNNING";
    case "command.completed":
      return "COMPLETED";
    case "command.failed":
      return "FAILED";
    case "command.cancelled":
      return "CANCELLED";
    default:
      return undefined;
  }
}

export function taskStatusForCommandEvent(
  type: Event["type"],
): "DONE" | "FAILED" | "PAUSED" | undefined {
  switch (type) {
    case "command.completed":
      return "DONE";
    case "command.failed":
      return "FAILED";
    case "command.cancelled":
      return "PAUSED";
    default:
      return undefined;
  }
}

export function transferMeetsQuantity(
  result: unknown,
  requestedQuantity: number,
  expectedItemKey?: string,
): boolean {
  if (!isRecord(result) || typeof result.moved !== "number") return false;
  if (expectedItemKey !== undefined && result.itemKey !== expectedItemKey) return false;
  return Number.isSafeInteger(result.moved) && result.moved >= requestedQuantity;
}

export function gatherResultMeetsTarget(
  result: unknown,
  expectedItemKey: string,
  requestedQuantity: number,
): boolean {
  if (!isRecord(result)) return false;
  return (
    result.status === "OK" &&
    result.itemKey === expectedItemKey &&
    typeof result.collected === "number" &&
    Number.isSafeInteger(result.collected) &&
    result.collected >= requestedQuantity
  );
}

export function isInventoryFullFailure(event: Event): boolean {
  if (event.type !== "command.failed") return false;
  const payloadValue: unknown = event.payload;
  const payload = isRecord(payloadValue) ? payloadValue : undefined;
  if (!payload) return false;
  const error = payload.error;
  if (!isRecord(error) || !isRecord(error.details)) return false;
  if (error.details.status === "INVENTORY_FULL") return true;
  const result = error.details.result;
  return isRecord(result) && result.status === "INVENTORY_FULL";
}

export interface InventoryFullRecoveryPlan {
  readonly targetWorkerId: string;
  readonly itemKey: string;
  readonly destination: string;
  readonly quantity: number;
  readonly depositQuantity: number;
}

/**
 * Convert an inventory-full gather failure into a bounded delivery/resume plan.
 * The database workflow still decides whether the named destination is known and
 * whether a safe route exists; this helper only validates the event evidence and
 * preserves the requested quantity for the next gather step.
 */
export function inventoryFullRecoveryPlan(
  event: Event,
  parentArguments: Record<string, unknown>,
): InventoryFullRecoveryPlan | undefined {
  if (!isInventoryFullFailure(event)) return undefined;
  const targetWorkerId = parentArguments.targetWorkerId;
  const itemKey = parentArguments.itemKey;
  const destination = parentArguments.destination;
  const configuredQuantity = parentArguments.quantity;
  const remainingQuantity = integerArgument(parentArguments, "remainingQuantity", 0);
  const quantity = remainingQuantity > 0 ? remainingQuantity : configuredQuantity;
  const payload = isRecord(event.payload) ? (event.payload as Record<string, unknown>) : undefined;
  const error = payload && isRecord(payload.error) ? payload.error : undefined;
  const details = error && isRecord(error.details) ? error.details : undefined;
  const result = details && isRecord(details.result) ? details.result : undefined;
  const collected = result?.collected;
  if (
    typeof targetWorkerId !== "string" ||
    typeof itemKey !== "string" ||
    typeof destination !== "string" ||
    typeof quantity !== "number" ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    typeof collected !== "number" ||
    !Number.isSafeInteger(collected) ||
    collected < 1
  ) {
    return undefined;
  }
  return {
    targetWorkerId,
    itemKey,
    destination,
    quantity,
    depositQuantity: Math.min(quantity, collected),
  };
}

export function blockedMovementForReplan(
  event: Event,
): { readonly position: Coordinate; readonly direction: string } | undefined {
  if (event.type !== "command.failed") return undefined;
  const payload = isRecord(event.payload) ? (event.payload as Record<string, unknown>) : undefined;
  const error = payload && isRecord(payload.error) ? payload.error : undefined;
  const details = error && isRecord(error.details) ? error.details : undefined;
  const result = details && isRecord(details.result) ? details.result : undefined;
  if (!result || result.status !== "BLOCKED") return undefined;
  const position = coordinateFromUnknown(result.position);
  const direction = result.direction;
  if (!position || typeof direction !== "string") return undefined;
  return { position, direction };
}

export function workflowStepEventCanAdvance(taskStatus: string, eventType: Event["type"]): boolean {
  return (
    (eventType === "command.completed" && taskStatus === "DONE") ||
    (eventType === "command.failed" && taskStatus === "FAILED")
  );
}

function updateStatusForEvent(type: Event["type"]): UpdateStatus | undefined {
  switch (type) {
    case "worker.update.started":
    case "gateway.update.started":
      return "RUNNING";
    case "worker.update.staged":
    case "gateway.update.staged":
      return "CANARY";
    case "worker.update.activated":
    case "gateway.update.activated":
      return "SUCCEEDED";
    case "worker.update.failed":
    case "gateway.update.failed":
      return "FAILED";
    case "worker.update.rolled_back":
    case "gateway.update.rolled_back":
      return "ROLLED_BACK";
    default:
      return undefined;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function timestampString(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function plannerTriggerRecord(row: Record<string, unknown>): PlannerTriggerRecord {
  return {
    triggerId: String(row.triggerId),
    cause: String(row.cause),
    subjectId: String(row.subjectId),
    occurredAt: timestampString(row.occurredAt as Date | string)!,
    priority: Number(row.priority),
    status: String(row.status),
    attempts: Number(row.attempts),
    claimedAt: timestampString(row.claimedAt as Date | string | null),
    lastError: row.lastError,
    createdAt: timestampString(row.createdAt as Date | string)!,
    processedAt: timestampString(row.processedAt as Date | string | null),
  };
}

function plannerRuntimeStateRecord(row: Record<string, unknown>): PlannerRuntimeStateRecord {
  const state = String(row.state);
  if (state !== "AVAILABLE" && state !== "DEGRADED" && state !== "PAUSED") {
    throw new Error(`invalid planner runtime state: ${state}`);
  }
  return {
    state,
    consecutiveFailures: Number(row.consecutiveFailures),
    lastFailureAt: timestampString(row.lastFailureAt as Date | string | null),
    retryAfter: timestampString(row.retryAfter as Date | string | null),
    updatedAt: timestampString(row.updatedAt as Date | string)!,
  };
}

export class GatewayRuntimeRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly config: GatewayRuntimeConfig,
  ) {}

  private async recordWalkablePosition(
    client: PoolClient,
    workerId: string,
    position: {
      readonly dimension: number;
      readonly x: number;
      readonly y: number;
      readonly z: number;
    },
    observedAt: Date,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO world_cells (
          dimension, x, y, z, block_name, block_metadata, walkable, observed_at, source_worker_id
        )
        VALUES ($1, $2, $3, $4, NULL, NULL, TRUE, $5, $6)
        ON CONFLICT (dimension, x, y, z) DO UPDATE SET
          walkable = TRUE,
          observed_at = EXCLUDED.observed_at,
          source_worker_id = EXCLUDED.source_worker_id
        WHERE world_cells.observed_at <= EXCLUDED.observed_at
      `,
      [position.dimension, position.x, position.y, position.z, observedAt, workerId],
    );
  }

  private async recordInventorySnapshot(
    client: PoolClient,
    workerKey: string,
    slots: readonly unknown[],
    observedAt: Date,
  ): Promise<void> {
    const worker = await client.query<{ id: string }>(
      `SELECT id::text FROM workers WHERE worker_key = $1`,
      [workerKey],
    );
    const workerId = worker.rows[0]?.id;
    if (!workerId) return;

    const updated = await client.query(
      `
        UPDATE worker_observations
        SET inventory_json = $2, observed_at = $3
        WHERE id = (
          SELECT id FROM worker_observations
          WHERE worker_id = $1
          ORDER BY observed_at DESC, id DESC
          LIMIT 1
        )
        RETURNING id
      `,
      [workerId, asJson(slots), observedAt],
    );
    if (!updated.rowCount) {
      await client.query(
        `
          INSERT INTO worker_observations (worker_id, observed_at, inventory_json, status)
          VALUES ($1, $2, $3, 'ONLINE')
        `,
        [workerId, observedAt, asJson(slots)],
      );
    }
  }

  private async queueGatherDelivery(
    client: PoolClient,
    input: {
      readonly jobId: string;
      readonly parentTaskId: string;
      readonly targetWorkerId: string;
      readonly itemKey: string;
      readonly destination: string;
      readonly position: Coordinate;
      readonly depositQuantity: number;
      readonly remainingQuantity: number;
      readonly resumeGatherAfterDeposit: boolean;
    },
  ): Promise<boolean> {
    const locationResult = await client.query<{
      dimension: number;
      x: number;
      y: number;
      z: number;
      approach: unknown;
    }>(
      `
        SELECT dimension, x, y, z, approach_json AS approach
        FROM named_locations
        WHERE LOWER(name) = LOWER($1)
        LIMIT 1
      `,
      [input.destination.trim()],
    );
    const location = locationResult.rows[0];
    const target = coordinateFromUnknown(location?.approach) ?? coordinateFromUnknown(location);
    if (!target || target.dimension !== input.position.dimension) return false;

    const world = new SparseWorldModel();
    const worldResult = await client.query<{
      dimension: number;
      x: number;
      y: number;
      z: number;
      walkable: boolean;
      observed_at: Date;
      source_worker_id: string | null;
    }>(
      `
        SELECT dimension, x, y, z, walkable, observed_at, source_worker_id::text
        FROM world_cells
        WHERE observed_at >= NOW() - ($1::text || ' seconds')::interval
        LIMIT 10000
      `,
      [this.config.worldCellMaxAgeSeconds],
    );
    for (const cell of worldResult.rows) {
      world.setCell({
        dimension: cell.dimension,
        x: cell.x,
        y: cell.y,
        z: cell.z,
        walkable: cell.walkable,
        observedAt: cell.observed_at.toISOString(),
        source: cell.source_worker_id ?? "unknown",
      });
    }
    const path = findKnownPath(world, input.position, target, { maxNodes: 10_000 });
    if (!path || path.directions.length > 1024) return false;

    const containerId = normalizeContainerId(input.destination);
    if (!containerId) return false;

    const active = await client.query(
      `
        SELECT 1
        FROM tasks
        WHERE parent_task_id = $1
          AND workflow_phase IN ('NAVIGATE', 'DEPOSIT')
          AND status IN ('READY', 'RUNNING')
        LIMIT 1
      `,
      [input.parentTaskId],
    );
    if (active.rowCount) return true;

    if (input.resumeGatherAfterDeposit) {
      await client.query(
        `
          UPDATE tasks
          SET status = 'RUNNING',
              arguments_json = jsonb_set(
                jsonb_set(
                  jsonb_set(arguments_json, '{pendingDepositQuantity}', to_jsonb($2::int), true),
                  '{resumeGatherAfterDeposit}', 'true'::jsonb, true
                ),
                '{remainingQuantity}', to_jsonb($4::int), true
              ),
              last_error_json = $3
          WHERE id = $1 AND status IN ('READY', 'RUNNING')
        `,
        [
          input.parentTaskId,
          input.depositQuantity,
          asJson({
            reason: "worker inventory full; returning to the named container before resuming",
            depositQuantity: input.depositQuantity,
          }),
          input.remainingQuantity,
        ],
      );
    } else {
      await client.query(`UPDATE tasks SET status = 'RUNNING' WHERE id = $1 AND status = 'READY'`, [
        input.parentTaskId,
      ]);
    }

    if (path.directions.length > 0) {
      await client.query(
        `
          INSERT INTO tasks (
            job_id, kind, status, skill_name, arguments_json, parent_task_id, workflow_phase
          )
          VALUES ($1, 'workflow-step', 'READY', 'navigate.path', $2, $3, 'NAVIGATE')
        `,
        [
          input.jobId,
          asJson({ targetWorkerId: input.targetWorkerId, steps: path.directions }),
          input.parentTaskId,
        ],
      );
    } else {
      await client.query(
        `
          INSERT INTO tasks (
            job_id, kind, status, skill_name, arguments_json, parent_task_id, workflow_phase
          )
          VALUES ($1, 'workflow-step', 'READY', 'inventory.deposit', $2, $3, 'DEPOSIT')
        `,
        [
          input.jobId,
          asJson({
            targetWorkerId: input.targetWorkerId,
            containerId,
            itemKey: input.itemKey,
            quantity: input.depositQuantity,
          }),
          input.parentTaskId,
        ],
      );
    }
    return true;
  }

  public async createGoal(input: CreateGoalInput): Promise<GoalTaskRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const project = await client.query<IdRow>(
        `
          INSERT INTO projects (name, created_by_principal, goal_text)
          VALUES ($1, $2, $3)
          RETURNING id::text
        `,
        [input.projectName, input.createdByPrincipal, input.goalText],
      );
      const projectId = project.rows[0]?.id;
      if (!projectId) throw new Error("project insert did not return an id");

      const job = await client.query<IdRow>(
        `
          INSERT INTO jobs (project_id, status, priority, required_capabilities_json)
          VALUES ($1, 'READY', $2, $3)
          RETURNING id::text
        `,
        [projectId, input.priority, asJson(input.requiredCapabilities ?? [])],
      );
      const jobId = job.rows[0]?.id;
      if (!jobId) throw new Error("job insert did not return an id");

      const task = await client.query<IdRow>(
        `
          INSERT INTO tasks (job_id, kind, status, skill_name, arguments_json)
          VALUES ($1, 'goal', 'READY', $2, $3)
          RETURNING id::text
        `,
        [jobId, input.skillName, asJson(input.arguments)],
      );
      const taskId = task.rows[0]?.id;
      if (!taskId) throw new Error("task insert did not return an id");

      if (input.skillName === "resource.gather" && isRecord(input.arguments)) {
        const targetWorkerId = input.arguments.targetWorkerId;
        const itemKey = input.arguments.itemKey;
        const quantity = input.arguments.quantity;
        if (
          typeof targetWorkerId === "string" &&
          typeof itemKey === "string" &&
          typeof quantity === "number" &&
          Number.isSafeInteger(quantity) &&
          quantity > 0
        ) {
          await client.query(
            `
              INSERT INTO tasks (
                job_id, kind, status, skill_name, arguments_json, parent_task_id, workflow_phase
              )
              VALUES ($1, 'workflow-step', 'READY', 'mining.gather', $2, $3, 'GATHER')
            `,
            [
              jobId,
              asJson({
                targetWorkerId,
                itemKey,
                quantity,
                maxDepth: 64,
              }),
              taskId,
            ],
          );
        }
      }
      await client.query(
        `
          INSERT INTO planner_triggers (trigger_id, cause, subject_id, occurred_at, priority)
          VALUES ($1, 'goal.created', $2, NOW(), $3)
          ON CONFLICT (trigger_id) DO NOTHING
        `,
        [`goal-${taskId}`, taskId, input.priority],
      );
      await client.query("COMMIT");
      return {
        projectId,
        jobId,
        taskId,
        goalText: input.goalText,
        status: "READY",
        skillName: input.skillName,
        arguments: input.arguments,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Apply the narrow, safe subset of planner output that can become ready tasks.
   * The caller controls whether this boundary is enabled; this method still
   * validates every proposal as a real protocol command before persisting it.
   */
  public async applyPlannerTaskProposals(input: {
    readonly triggerId: string;
    readonly subjectId: string;
    readonly proposals: readonly PlannerTaskProposalInput[];
  }): Promise<readonly string[]> {
    if (
      !input.triggerId ||
      !input.subjectId ||
      input.proposals.length < 1 ||
      input.proposals.length > 64
    ) {
      throw new RepositoryError(
        "INVALID_PLANNER_DECISION",
        "planner task application requires one to 64 proposals and a trigger subject",
        400,
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sourceResult = await client.query<{
        id: string;
        job_id: string;
        arguments_json: unknown;
        required_capabilities_json: unknown;
      }>(
        `
          SELECT t.id::text, t.job_id::text, t.arguments_json,
                 j.required_capabilities_json
          FROM tasks t
          JOIN jobs j ON j.id = t.job_id
          WHERE t.id = $1
          FOR UPDATE OF t
        `,
        [input.subjectId],
      );
      const source = sourceResult.rows[0];
      if (!source) {
        throw new RepositoryError("UNKNOWN_TASK", "planner subject task was not found", 404);
      }
      const sourceArguments = parseJson<Record<string, unknown>>(source.arguments_json);
      const sourceTarget = sourceArguments.targetWorkerId;
      if (sourceTarget !== undefined && typeof sourceTarget !== "string") {
        throw new RepositoryError(
          "INVALID_PLANNER_DECISION",
          "planner subject has an invalid target worker",
          400,
        );
      }
      const jobCapabilities = new Set(
        capabilityNames(parseJson<unknown>(source.required_capabilities_json)),
      );
      const taskIds: string[] = [];
      let previousTaskId: string | undefined;
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + 10 * 60_000);

      for (let index = 0; index < input.proposals.length; index += 1) {
        const proposal = input.proposals[index]!;
        const skill = SkillNameSchema.safeParse(proposal.skillName);
        if (!skill.success) {
          throw new RepositoryError(
            "INVALID_PLANNER_DECISION",
            `planner proposed unsupported skill: ${proposal.skillName}`,
            400,
          );
        }
        if (
          !Number.isSafeInteger(proposal.priority) ||
          proposal.priority < -1000 ||
          proposal.priority > 1000 ||
          !Array.isArray(proposal.requiredCapabilities) ||
          proposal.requiredCapabilities.some(
            (capability) => typeof capability !== "string" || capability.trim() === "",
          )
        ) {
          throw new RepositoryError(
            "INVALID_PLANNER_DECISION",
            "planner task metadata is invalid",
            400,
          );
        }
        const rawArguments = proposal.arguments;
        const requestedTarget = rawArguments.targetWorkerId;
        if (requestedTarget !== undefined && typeof requestedTarget !== "string") {
          throw new RepositoryError(
            "INVALID_PLANNER_DECISION",
            "planner targetWorkerId must be a string",
            400,
          );
        }
        if (sourceTarget && requestedTarget && sourceTarget !== requestedTarget) {
          throw new RepositoryError(
            "PLANNER_SCOPE_VIOLATION",
            "planner cannot retarget a task to another worker",
            409,
          );
        }
        const targetWorkerId = requestedTarget ?? sourceTarget;
        const commandArgumentsJson = commandArguments(rawArguments);
        const commandValidation = CommandSchema.safeParse({
          protocolVersion: 1,
          commandId: `planner-${input.triggerId}-${index}`.slice(0, 128),
          taskId: `planner-${input.triggerId}-${index}`.slice(0, 128),
          workerId: targetWorkerId ?? "planner",
          issuedAt: issuedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          budget: commandBudget(skill.data, commandArgumentsJson),
          skill: skill.data,
          arguments: commandArgumentsJson,
        });
        if (!commandValidation.success) {
          throw new RepositoryError(
            "INVALID_PLANNER_DECISION",
            `planner arguments are invalid for ${skill.data}`,
            400,
          );
        }
        const effectiveCapabilities =
          proposal.requiredCapabilities.length > 0 ? proposal.requiredCapabilities : [skill.data];
        const unsupportedCapabilities = effectiveCapabilities.filter(
          (capability) => !jobCapabilities.has(capability),
        );
        if (unsupportedCapabilities.length > 0) {
          throw new RepositoryError(
            "PLANNER_SCOPE_VIOLATION",
            "planner proposal requires capabilities outside the subject job",
            409,
          );
        }

        const existing = await client.query<{ id: string }>(
          `
            SELECT id::text
            FROM tasks
            WHERE job_id = $1
              AND arguments_json->>'_plannerTriggerId' = $2
              AND arguments_json->>'_plannerIndex' = $3
            LIMIT 1
          `,
          [source.job_id, input.triggerId, String(index)],
        );
        const taskId = existing.rows[0]?.id;
        if (taskId) {
          taskIds.push(taskId);
          previousTaskId = taskId;
          continue;
        }

        const storedArguments = {
          ...commandArgumentsJson,
          ...(targetWorkerId ? { targetWorkerId } : {}),
          _plannerTriggerId: input.triggerId,
          _plannerIndex: index,
          _plannerPriority: proposal.priority,
        };
        const inserted = await client.query<{ id: string }>(
          `
            INSERT INTO tasks (
              job_id, kind, status, skill_name, arguments_json, parent_task_id
            )
            VALUES ($1, 'planner-task', 'READY', $2, $3, $4)
            RETURNING id::text
          `,
          [source.job_id, skill.data, asJson(storedArguments), source.id],
        );
        const insertedTaskId = inserted.rows[0]?.id;
        if (!insertedTaskId) {
          throw new RepositoryError("INTERNAL_ERROR", "planner task insert returned no row", 500);
        }
        if (previousTaskId) {
          await client.query(
            `
              INSERT INTO task_dependencies (task_id, depends_on_task_id)
              VALUES ($1, $2)
              ON CONFLICT DO NOTHING
            `,
            [insertedTaskId, previousTaskId],
          );
        }
        taskIds.push(insertedTaskId);
        previousTaskId = insertedTaskId;
      }
      await client.query("COMMIT");
      return taskIds;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async listGoals(): Promise<readonly Record<string, unknown>[]> {
    const result = await this.pool.query(
      `
        SELECT p.id::text AS "projectId", j.id::text AS "jobId", t.id::text AS "taskId",
               p.goal_text AS "goalText", p.status AS "projectStatus", j.status AS "jobStatus",
               t.status AS "taskStatus", t.skill_name AS "skillName", t.arguments_json AS arguments
        FROM projects p
        JOIN jobs j ON j.project_id = p.id
        JOIN tasks t ON t.job_id = j.id
        ORDER BY p.created_at DESC, t.id DESC
      `,
    );
    return result.rows;
  }

  public async listProjects(): Promise<readonly Record<string, unknown>[]> {
    const result = await this.pool.query(
      `
        SELECT p.id::text AS "projectId", p.name, p.created_by_principal AS "createdByPrincipal",
               p.status, p.goal_text AS "goalText", p.created_at AS "createdAt",
               p.updated_at AS "updatedAt", COUNT(DISTINCT j.id)::int AS "jobCount",
               COUNT(t.id)::int AS "taskCount"
        FROM projects p
        LEFT JOIN jobs j ON j.project_id = p.id
        LEFT JOIN tasks t ON t.job_id = j.id
        GROUP BY p.id
        ORDER BY p.created_at DESC, p.id DESC
      `,
    );
    return result.rows;
  }

  public async listAgents(): Promise<readonly Record<string, unknown>[]> {
    const result = await this.pool.query(
      `
        SELECT a.id::text AS "agentId", a.name, a.backend_type AS "backendType",
               a.enabled, a.worker_binding_id::text AS "workerBindingId",
               w.worker_key AS "workerId", a.capability_policy_id AS "capabilityPolicyId",
               a.created_at AS "createdAt", a.updated_at AS "updatedAt"
        FROM agents a
        LEFT JOIN workers w ON w.id = a.worker_binding_id
        ORDER BY a.name
      `,
    );
    return result.rows;
  }

  public async getAgent(name: string): Promise<Record<string, unknown> | undefined> {
    const result = await this.pool.query(
      `
        SELECT a.id::text AS "agentId", a.name, a.backend_type AS "backendType",
               a.enabled, a.worker_binding_id::text AS "workerBindingId",
               w.worker_key AS "workerId", a.capability_policy_id AS "capabilityPolicyId",
               a.created_at AS "createdAt", a.updated_at AS "updatedAt"
        FROM agents a
        LEFT JOIN workers w ON w.id = a.worker_binding_id
        WHERE LOWER(a.name) = LOWER($1)
      `,
      [name],
    );
    return result.rows[0];
  }

  public async listTasks(): Promise<readonly Record<string, unknown>[]> {
    return new TaskRepository(this.pool).listTasks();
  }

  public async getTask(taskId: string): Promise<Record<string, unknown> | undefined> {
    return new TaskRepository(this.pool).getTask(taskId);
  }

  public async getGoalReport(taskId: string): Promise<Record<string, unknown> | undefined> {
    const anchor = await this.pool.query(
      `
        SELECT p.id::text AS "projectId", j.id::text AS "jobId",
               root.id::text AS "rootTaskId", p.goal_text AS "goalText",
               p.status AS "projectStatus", j.status AS "jobStatus",
               anchor.status AS "taskStatus"
        FROM tasks anchor
        JOIN jobs j ON j.id = anchor.job_id
        JOIN projects p ON p.id = j.project_id
        LEFT JOIN tasks root ON root.job_id = j.id AND root.parent_task_id IS NULL
        WHERE anchor.id = $1
        LIMIT 1
      `,
      [taskId],
    );
    const header = anchor.rows[0] as Record<string, unknown> | undefined;
    if (!header) return undefined;

    const tasks = await this.pool.query(
      `
        SELECT t.id::text AS "taskId", t.parent_task_id::text AS "parentTaskId",
               t.workflow_phase AS "workflowPhase", t.kind, t.status,
               t.skill_name AS "skillName", t.assigned_worker_id::text AS "assignedWorkerId",
               t.attempt_count AS "attemptCount", t.last_error_json AS "lastError"
        FROM tasks t
        WHERE t.job_id = $1
        ORDER BY t.id
      `,
      [header.jobId],
    );
    return { ...header, tasks: tasks.rows };
  }

  public async listPlannerTriggers(limit = 100): Promise<readonly PlannerTriggerRecord[]> {
    const result = await this.pool.query(
      `
        SELECT trigger_id AS "triggerId", cause, subject_id AS "subjectId",
               occurred_at AS "occurredAt", priority, status, attempts,
               claimed_at AS "claimedAt", last_error_json AS "lastError", created_at AS "createdAt",
               processed_at AS "processedAt"
        FROM planner_triggers
        ORDER BY CASE WHEN status = 'PENDING' THEN 0 ELSE 1 END,
                 priority DESC, occurred_at, trigger_id
        LIMIT $1
      `,
      [limit],
    );
    return result.rows.map((row) => plannerTriggerRecord(row));
  }

  public async getPlannerRuntimeState(): Promise<PlannerRuntimeStateRecord> {
    const result = await this.pool.query(
      `
        SELECT state, consecutive_failures AS "consecutiveFailures",
               last_failure_at AS "lastFailureAt", retry_after AS "retryAfter",
               updated_at AS "updatedAt"
        FROM planner_runtime_state
        WHERE runtime_id = 'default'
      `,
    );
    const row = result.rows[0];
    if (!row) {
      return {
        state: "AVAILABLE",
        consecutiveFailures: 0,
        lastFailureAt: null,
        retryAfter: null,
        updatedAt: new Date(0).toISOString(),
      };
    }
    return plannerRuntimeStateRecord(row);
  }

  public async savePlannerRuntimeState(
    state: Omit<PlannerRuntimeStateRecord, "updatedAt">,
  ): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO planner_runtime_state (
          runtime_id, state, consecutive_failures, last_failure_at, retry_after, updated_at
        )
        VALUES ('default', $1, $2, $3, $4, NOW())
        ON CONFLICT (runtime_id) DO UPDATE SET
          state = EXCLUDED.state,
          consecutive_failures = EXCLUDED.consecutive_failures,
          last_failure_at = EXCLUDED.last_failure_at,
          retry_after = EXCLUDED.retry_after,
          updated_at = NOW()
      `,
      [state.state, state.consecutiveFailures, state.lastFailureAt, state.retryAfter],
    );
  }

  public async claimPlannerTriggers(limit = 1): Promise<readonly PlannerTriggerRecord[]> {
    const result = await this.pool.query(
      `
        WITH eligible AS (
          SELECT trigger_id
          FROM planner_triggers
          WHERE status = 'PENDING'
          ORDER BY priority DESC, occurred_at, trigger_id
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        UPDATE planner_triggers trigger
        SET status = 'PROCESSING', attempts = trigger.attempts + 1, claimed_at = NOW()
        FROM eligible
        WHERE trigger.trigger_id = eligible.trigger_id
        RETURNING trigger.trigger_id AS "triggerId", trigger.cause,
                  trigger.subject_id AS "subjectId", trigger.occurred_at AS "occurredAt",
                  trigger.priority, trigger.status, trigger.attempts,
                  trigger.claimed_at AS "claimedAt", trigger.last_error_json AS "lastError",
                  trigger.created_at AS "createdAt",
                  trigger.processed_at AS "processedAt"
      `,
      [limit],
    );
    return result.rows.map((row) => plannerTriggerRecord(row));
  }

  public async completePlannerTrigger(
    triggerId: string,
    status: Extract<PlannerTriggerStatus, "SUCCEEDED" | "FAILED">,
    lastError?: unknown,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE planner_triggers
        SET status = $2, claimed_at = NULL, last_error_json = $3, processed_at = NOW()
        WHERE trigger_id = $1 AND status = 'PROCESSING'
      `,
      [triggerId, status, lastError === undefined ? null : asJson(lastError)],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async releasePlannerTrigger(triggerId: string, lastError?: unknown): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE planner_triggers
        SET status = 'PENDING', claimed_at = NULL,
            last_error_json = $2, processed_at = NULL
        WHERE trigger_id = $1 AND status = 'PROCESSING'
      `,
      [triggerId, lastError === undefined ? null : asJson(lastError)],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async requeueStalePlannerTriggers(staleAfterSeconds = 300): Promise<number> {
    if (!Number.isSafeInteger(staleAfterSeconds) || staleAfterSeconds < 1) {
      throw new Error("staleAfterSeconds must be a positive integer");
    }
    const result = await this.pool.query(
      `
        UPDATE planner_triggers
        SET status = 'PENDING', claimed_at = NULL
        WHERE status = 'PROCESSING'
          AND claimed_at < NOW() - ($1::text || ' seconds')::interval
      `,
      [staleAfterSeconds],
    );
    return result.rowCount ?? 0;
  }

  private async recordPlannerTrigger(client: PoolClient, event: Event): Promise<void> {
    let cause: string | undefined;
    let subjectId: string | undefined;
    if (event.type === "command.completed" || event.type === "command.failed") {
      if (event.commandId) {
        const task = await client.query<{ task_id: string }>(
          `SELECT task_id::text FROM gateway_commands WHERE command_id = $1`,
          [event.commandId],
        );
        subjectId = task.rows[0]?.task_id;
        cause = event.type;
      }
    } else if (event.type === "movement.blocked" && event.workerId) {
      cause = "worker.blocked";
      subjectId = event.workerId;
    }
    if (!cause || !subjectId) return;
    await client.query(
      `
        INSERT INTO planner_triggers (trigger_id, cause, subject_id, occurred_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (trigger_id) DO NOTHING
      `,
      [`event-${event.eventId}`, cause, subjectId, new Date(event.occurredAt)],
    );
  }

  public async listRunnableTasks(): Promise<readonly Record<string, unknown>[]> {
    return new TaskRepository(this.pool).listRunnableTasks();
  }

  public async claimTask(taskId: string, workerKey: string): Promise<Record<string, unknown>> {
    return new TaskRepository(this.pool).claimReadyTask(taskId, workerKey);
  }

  public async transitionTask(taskId: string, nextState: string, reason?: string): Promise<void> {
    return new TaskRepository(this.pool).transitionTask(taskId, nextState, reason);
  }

  public async dispatchTask(
    taskId: string,
    workerKey: string,
    commandId: string,
  ): Promise<Command> {
    return new TaskRepository(this.pool).dispatchTask(taskId, workerKey, commandId);
  }

  public async upsertNamedLocation(input: NamedLocationInput): Promise<Record<string, unknown>> {
    const result = await this.pool.query(
      `
        INSERT INTO named_locations (
          name, dimension, x, y, z, facing, approach_json, source, confidence, observed_at, metadata_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
        ON CONFLICT (name) DO UPDATE SET
          dimension = EXCLUDED.dimension,
          x = EXCLUDED.x,
          y = EXCLUDED.y,
          z = EXCLUDED.z,
          facing = EXCLUDED.facing,
          approach_json = EXCLUDED.approach_json,
          source = EXCLUDED.source,
          confidence = EXCLUDED.confidence,
          observed_at = EXCLUDED.observed_at,
          metadata_json = EXCLUDED.metadata_json
        RETURNING id::text AS "locationId", name, dimension, x, y, z, facing,
                  approach_json AS approach, source, confidence,
                  observed_at AS "observedAt", metadata_json AS metadata
      `,
      [
        input.name.trim(),
        input.dimension,
        input.x,
        input.y,
        input.z,
        input.facing ?? null,
        asJson(input.approach ?? null),
        input.source.trim(),
        input.confidence,
        asJson(input.metadata),
      ],
    );
    const location = result.rows[0];
    if (!location) {
      throw new RepositoryError("INTERNAL_ERROR", "named location upsert returned no row", 500);
    }
    await this.pool.query(
      `
        INSERT INTO world_cells (
          dimension, x, y, z, block_name, block_metadata, walkable, observed_at, source_worker_id
        )
        VALUES ($1, $2, $3, $4, NULL, NULL, TRUE, NOW(), NULL)
        ON CONFLICT (dimension, x, y, z) DO UPDATE SET
          walkable = TRUE,
          observed_at = NOW(),
          source_worker_id = NULL
        WHERE world_cells.observed_at <= NOW()
      `,
      [input.dimension, input.x, input.y, input.z],
    );
    const approach = coordinateFromUnknown(input.approach);
    if (
      approach &&
      (approach.dimension !== input.dimension ||
        approach.x !== input.x ||
        approach.y !== input.y ||
        approach.z !== input.z)
    ) {
      await this.pool.query(
        `
          INSERT INTO world_cells (
            dimension, x, y, z, block_name, block_metadata, walkable, observed_at, source_worker_id
          )
          VALUES ($1, $2, $3, $4, NULL, NULL, TRUE, NOW(), NULL)
          ON CONFLICT (dimension, x, y, z) DO UPDATE SET
            walkable = TRUE,
            observed_at = NOW(),
            source_worker_id = NULL
          WHERE world_cells.observed_at <= NOW()
        `,
        [approach.dimension, approach.x, approach.y, approach.z],
      );
    }
    return location;
  }

  public async listNamedLocations(): Promise<readonly Record<string, unknown>[]> {
    const result = await this.pool.query(
      `
        SELECT id::text AS "locationId", name, dimension, x, y, z, facing,
               approach_json AS approach, source, confidence,
               observed_at AS "observedAt", metadata_json AS metadata
        FROM named_locations
        ORDER BY name
      `,
    );
    return result.rows;
  }

  public async resolveNamedLocation(name: string): Promise<Record<string, unknown> | undefined> {
    const result = await this.pool.query(
      `
        SELECT id::text AS "locationId", name, dimension, x, y, z, facing,
               approach_json AS approach, source, confidence,
               observed_at AS "observedAt", metadata_json AS metadata
        FROM named_locations
        WHERE LOWER(name) = LOWER($1)
        LIMIT 1
      `,
      [name.trim()],
    );
    return result.rows[0];
  }

  public async listWorldCells(): Promise<readonly Record<string, unknown>[]> {
    const result = await this.pool.query(
      `
        SELECT dimension, x, y, z, block_name AS "blockName", block_metadata AS "blockMetadata",
               walkable, observed_at AS "observedAt", source_worker_id::text AS "sourceWorkerId"
        FROM world_cells
        WHERE observed_at >= NOW() - ($1::text || ' seconds')::interval
        ORDER BY observed_at DESC
        LIMIT 1000
      `,
      [this.config.worldCellMaxAgeSeconds],
    );
    return result.rows;
  }

  public async listAuditEvents(limit: number): Promise<readonly Record<string, unknown>[]> {
    return new AuditEventRepository(this.pool).listRecent(limit);
  }

  public async register(
    payload: Omit<GatewayRegistration, "capabilities"> & { readonly capabilities?: unknown },
  ): Promise<GatewayIdentity> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const previousGateway = await client.query<GatewayRow>(
        `SELECT id, gateway_key, boot_id FROM gateways WHERE gateway_key = $1 FOR UPDATE`,
        [payload.gatewayId],
      );
      const gateway = await this.upsertGateway(client, payload.gatewayId, payload.bootId, {
        minecraftServerId: payload.minecraftServerId,
        runtimeVersion: payload.runtimeVersion ?? null,
        capabilities: payload.capabilities ?? [],
        status: "ONLINE",
      });

      if (previousGateway.rows[0] && previousGateway.rows[0].boot_id !== payload.bootId) {
        await this.reconcileGatewayRestart(client, gateway.id, payload.gatewayId, payload.bootId);
      }

      await client.query("UPDATE workers SET online = FALSE WHERE gateway_id = $1", [gateway.id]);
      for (const worker of payload.workers) {
        await this.upsertWorker(client, gateway.id, {
          workerKey: worker.workerId,
          computerId: worker.computerId,
          runtimeVersion: worker.runtimeVersion,
          capabilities: worker.capabilities,
          bootId: null,
          online: true,
          lastSeenAt: new Date(),
        });
      }

      await client.query("COMMIT");
      return { gatewayId: payload.gatewayId, bootId: payload.bootId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async heartbeat(payload: GatewayHeartbeat): Promise<GatewayIdentity> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const gateway = await this.findGateway(client, payload.gatewayId);
      if (!gateway) {
        throw new RepositoryError("UNKNOWN_GATEWAY", "gateway has not registered", 404);
      }
      if (gateway.boot_id !== payload.bootId) {
        throw new RepositoryError("STALE_GATEWAY_BOOT", "gateway boot id is stale", 409);
      }

      await client.query(
        `
          UPDATE gateways
          SET status = $2, last_seen_at = $3
          WHERE id = $1
        `,
        [gateway.id, payload.status, new Date(payload.sentAt)],
      );

      for (const worker of payload.workers) {
        const workerRow = await this.upsertWorker(client, gateway.id, {
          workerKey: worker.workerId,
          computerId: worker.computerId,
          runtimeVersion: worker.runtimeVersion,
          capabilities: worker.capabilities,
          bootId: worker.workerBootId,
          online: worker.status === "ONLINE",
          lastSeenAt: new Date(worker.lastSeenAt),
        });

        await client.query(
          `
            INSERT INTO worker_observations (
              worker_id, observed_at, dimension, x, y, z, facing,
              position_confidence, fuel_level, current_command_id, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `,
          [
            workerRow.id,
            new Date(worker.lastSeenAt),
            worker.position?.dimension ?? null,
            worker.position?.x ?? null,
            worker.position?.y ?? null,
            worker.position?.z ?? null,
            worker.position?.facing ?? null,
            storedPositionConfidence(worker.position?.confidence),
            worker.fuel?.level ?? null,
            worker.currentCommandId ?? null,
            worker.status,
          ],
        );
        if (worker.position) {
          await this.recordWalkablePosition(
            client,
            workerRow.id,
            worker.position,
            new Date(worker.lastSeenAt),
          );
        }
      }

      await client.query("COMMIT");
      return { gatewayId: payload.gatewayId, bootId: payload.bootId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async poll(gatewayId: string, after: string | null): Promise<GatewayPollResult> {
    const gateway = await this.findGateway(this.pool, gatewayId);
    if (!gateway) {
      throw new RepositoryError("UNKNOWN_GATEWAY", "gateway has not registered", 404);
    }

    const afterId = after === null ? 0 : this.parseCursor(after);
    const [commands, stopControls, updates] = await Promise.all([
      this.pool.query<CursorRow>(
        `
          SELECT id, delivery_cursor, payload_json
          FROM gateway_commands
          WHERE delivery_cursor > $1
            AND status IN ('QUEUED', 'DELIVERED', 'RUNNING')
            AND expires_at > NOW()
            AND transport_type = 'gateway-rednet'
            AND worker_key IN (SELECT worker_key FROM workers WHERE gateway_id = $2)
          ORDER BY delivery_cursor
          LIMIT 128
        `,
        [afterId, gateway.id],
      ),
      this.pool.query<CursorRow>(
        `
          SELECT id, delivery_cursor, payload_json
          FROM gateway_stop_controls
          WHERE delivery_cursor > $1
            AND (
              transport_type IS NULL
              OR transport_type = 'gateway-rednet'
            )
            AND (
              payload_json->>'type' = 'all.stop'
              OR worker_key IN (SELECT worker_key FROM workers WHERE gateway_id = $2)
            )
          ORDER BY delivery_cursor
          LIMIT 128
        `,
        [afterId, gateway.id],
      ),
      this.pool.query<UpdateRow>(
        `
          SELECT update_id, target, target_type, target_key, gateway_key, transport_type,
                 release_version, manifest_url, issued_at, expires_at, status,
                 failure_code, failure_message, started_at, completed_at,
                 created_at, delivery_cursor
          FROM update_rollouts
          WHERE delivery_cursor > $1
            AND gateway_key = $2
            AND transport_type = 'gateway-rednet'
            AND status IN ('QUEUED', 'RUNNING', 'CANARY')
            AND expires_at > NOW()
          ORDER BY delivery_cursor
          LIMIT 32
        `,
        [afterId, gateway.gateway_key],
      ),
    ]);

    const commandRows = commands.rows;
    const stopRows = stopControls.rows;
    const updateRows = updates.rows;
    const maxId = [...commandRows, ...stopRows, ...updateRows]
      .map((row) => BigInt(row.delivery_cursor))
      .reduce((maximum, value) => (value > maximum ? value : maximum), BigInt(afterId));

    if (commandRows.length > 0) {
      await this.pool.query(
        `
          UPDATE gateway_commands
          SET status = CASE WHEN status = 'QUEUED' THEN 'DELIVERED' ELSE status END,
              delivered_at = COALESCE(delivered_at, NOW())
          WHERE id = ANY($1::bigint[])
        `,
        [commandRows.map((row) => row.id)],
      );
    }

    if (stopRows.length > 0) {
      await this.pool.query(
        `UPDATE gateway_stop_controls SET delivered_at = COALESCE(delivered_at, NOW()) WHERE id = ANY($1::bigint[])`,
        [stopRows.map((row) => row.id)],
      );
    }

    return {
      commands: commandRows.map((row) => parseJson<Command>(row.payload_json)),
      stopControls: stopRows.map((row) => parseJson<StopControl>(row.payload_json)),
      updates: updateRows.map((row) => this.toUpdateControl(row)),
      nextCursor: maxId === BigInt(afterId) ? null : maxId.toString(),
    };
  }

  public async registerDirectWorker(
    payload: DirectWorkerRegistration,
  ): Promise<{ readonly workerId: string; readonly workerBootId: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<WorkerRow>(
        `SELECT id, worker_key, gateway_id, computer_id, transport_type, minecraft_server_id, boot_id
         FROM workers WHERE worker_key = $1`,
        [payload.workerId],
      );
      const existingRow = existing.rows[0] as
        (WorkerRow & { minecraft_server_id: string }) | undefined;
      if (!existingRow) {
        throw new RepositoryError(
          "UNKNOWN_WORKER",
          "direct worker must be provisioned before registration",
          404,
        );
      }
      if (
        existingRow.transport_type !== "direct-http" ||
        existingRow.minecraft_server_id !== payload.minecraftServerId
      ) {
        throw new RepositoryError(
          "WORKER_BOUND_ELSEWHERE",
          "worker is already registered with another transport or server",
          409,
        );
      }

      if (existingRow.boot_id && existingRow.boot_id !== payload.workerBootId) {
        await this.reconcileWorkerRestart(
          client,
          payload.workerId,
          existingRow.boot_id,
          payload.workerBootId,
          "direct-http",
        );
      }

      await client.query(
        `
          INSERT INTO workers (
            worker_key, backend_type, gateway_id, computer_id, minecraft_server_id,
            transport_type, online, boot_id, runtime_version, last_seen_at, capabilities_json
          )
          VALUES ($1, 'computercraft', NULL, $2, $3, 'direct-http', TRUE, $4, $5, NOW(), $6)
          ON CONFLICT (worker_key) DO UPDATE
          SET computer_id = EXCLUDED.computer_id,
              minecraft_server_id = EXCLUDED.minecraft_server_id,
              transport_type = EXCLUDED.transport_type,
              online = EXCLUDED.online,
              boot_id = EXCLUDED.boot_id,
              runtime_version = EXCLUDED.runtime_version,
              last_seen_at = EXCLUDED.last_seen_at,
              capabilities_json = EXCLUDED.capabilities_json
        `,
        [
          payload.workerId,
          payload.computerId,
          payload.minecraftServerId,
          payload.workerBootId,
          payload.runtimeVersion,
          asJson(payload.capabilities),
        ],
      );
      await client.query("COMMIT");
      return { workerId: payload.workerId, workerBootId: payload.workerBootId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async provisionDirectWorker(
    payload: DirectWorkerProvision,
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<WorkerRow>(
        `SELECT id, worker_key, gateway_id, computer_id, transport_type, minecraft_server_id
         FROM workers WHERE worker_key = $1`,
        [payload.workerId],
      );
      const existingRow = existing.rows[0];
      if (
        existingRow &&
        (existingRow.transport_type !== "direct-http" ||
          existingRow.minecraft_server_id !== payload.minecraftServerId)
      ) {
        throw new RepositoryError(
          "WORKER_BOUND_ELSEWHERE",
          "worker is already registered with another transport or server",
          409,
        );
      }

      const result = await client.query(
        `
          INSERT INTO workers (
            worker_key, backend_type, gateway_id, computer_id, minecraft_server_id,
            transport_type, online, runtime_version, capabilities_json
          )
          VALUES ($1, 'computercraft', NULL, $2, $3, 'direct-http', FALSE, $4, $5)
          ON CONFLICT (worker_key) DO UPDATE
          SET computer_id = EXCLUDED.computer_id,
              minecraft_server_id = EXCLUDED.minecraft_server_id,
              transport_type = EXCLUDED.transport_type,
              runtime_version = EXCLUDED.runtime_version,
              capabilities_json = EXCLUDED.capabilities_json
          RETURNING worker_key AS "workerId", computer_id AS "computerId", online,
                    transport_type AS "transport", minecraft_server_id AS "minecraftServerId"
        `,
        [
          payload.workerId,
          payload.computerId,
          payload.minecraftServerId,
          payload.runtimeVersion,
          asJson(payload.capabilities),
        ],
      );
      await client.query("COMMIT");
      return result.rows[0] as Record<string, unknown>;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async heartbeatDirectWorker(payload: DirectWorkerHeartbeat): Promise<{
    readonly workerId: string;
    readonly workerBootId: string;
  }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const worker = await client.query<WorkerRow>(
        `SELECT id, worker_key, gateway_id, computer_id, transport_type, minecraft_server_id, boot_id
         FROM workers WHERE worker_key = $1 AND transport_type = 'direct-http'`,
        [payload.workerId],
      );
      const row = worker.rows[0];
      if (!row) {
        throw new RepositoryError("UNKNOWN_WORKER", "direct worker has not registered", 404);
      }
      if (row.boot_id !== payload.workerBootId) {
        throw new RepositoryError("STALE_WORKER_BOOT", "worker boot id is stale", 409);
      }
      if (row.minecraft_server_id !== payload.minecraftServerId) {
        throw new RepositoryError(
          "WORKER_BOUND_ELSEWHERE",
          "worker is registered to another Minecraft server",
          409,
        );
      }

      await client.query(
        `
          UPDATE workers
          SET computer_id = $2, online = $3, boot_id = $4, runtime_version = $5,
              last_seen_at = $6, capabilities_json = $7
          WHERE id = $1
        `,
        [
          row.id,
          payload.computerId,
          payload.status === "ONLINE",
          payload.workerBootId,
          payload.runtimeVersion,
          new Date(payload.lastSeenAt),
          asJson(payload.capabilities),
        ],
      );
      await client.query(
        `
          INSERT INTO worker_observations (
            worker_id, observed_at, dimension, x, y, z, facing,
            position_confidence, fuel_level, current_command_id, status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          row.id,
          new Date(payload.lastSeenAt),
          payload.position?.dimension ?? null,
          payload.position?.x ?? null,
          payload.position?.y ?? null,
          payload.position?.z ?? null,
          payload.position?.facing ?? null,
          storedPositionConfidence(payload.position?.confidence),
          payload.fuel?.level ?? null,
          payload.currentCommandId ?? null,
          payload.status,
        ],
      );
      if (payload.position) {
        await this.recordWalkablePosition(
          client,
          row.id,
          payload.position,
          new Date(payload.lastSeenAt),
        );
      }
      await client.query("COMMIT");
      return { workerId: payload.workerId, workerBootId: payload.workerBootId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async pollDirectWorker(
    workerId: string,
    after: string | null,
  ): Promise<DirectWorkerPollResult> {
    const worker = await this.pool.query<{ id: string }>(
      `SELECT id FROM workers WHERE worker_key = $1 AND transport_type = 'direct-http'`,
      [workerId],
    );
    if (!worker.rows[0]) {
      throw new RepositoryError("UNKNOWN_WORKER", "direct worker has not registered", 404);
    }

    const afterId = after === null ? 0 : this.parseCursor(after);
    const [commands, stopControls, updates] = await Promise.all([
      this.pool.query<CursorRow>(
        `
          SELECT id, delivery_cursor, payload_json
          FROM gateway_commands
          WHERE delivery_cursor > $1
            AND status IN ('QUEUED', 'DELIVERED', 'RUNNING')
            AND expires_at > NOW()
            AND transport_type = 'direct-http'
            AND worker_key = $2
          ORDER BY delivery_cursor
          LIMIT 128
        `,
        [afterId, workerId],
      ),
      this.pool.query<CursorRow>(
        `
          SELECT id, delivery_cursor, payload_json
          FROM gateway_stop_controls
          WHERE delivery_cursor > $1
            AND (transport_type IS NULL OR transport_type = 'direct-http')
            AND (payload_json->>'type' = 'all.stop' OR worker_key = $2)
          ORDER BY delivery_cursor
          LIMIT 128
        `,
        [afterId, workerId],
      ),
      this.pool.query<UpdateRow>(
        `
          SELECT update_id, target, target_type, target_key, gateway_key, transport_type,
                 release_version, manifest_url, issued_at, expires_at, status,
                 failure_code, failure_message, started_at, completed_at,
                 created_at, delivery_cursor
          FROM update_rollouts
          WHERE delivery_cursor > $1
            AND transport_type = 'direct-http'
            AND target_type = 'worker'
            AND target_key = $2
            AND status IN ('QUEUED', 'RUNNING', 'CANARY')
            AND expires_at > NOW()
          ORDER BY delivery_cursor
          LIMIT 32
        `,
        [afterId, workerId],
      ),
    ]);

    const commandRows = commands.rows;
    const stopRows = stopControls.rows;
    const updateRows = updates.rows;
    const maxId = [...commandRows, ...stopRows, ...updateRows]
      .map((row) => BigInt(row.delivery_cursor))
      .reduce((maximum, value) => (value > maximum ? value : maximum), BigInt(afterId));

    if (commandRows.length > 0) {
      await this.pool.query(
        `
          UPDATE gateway_commands
          SET status = CASE WHEN status = 'QUEUED' THEN 'DELIVERED' ELSE status END,
              delivered_at = COALESCE(delivered_at, NOW())
          WHERE id = ANY($1::bigint[])
        `,
        [commandRows.map((row) => row.id)],
      );
    }
    if (stopRows.length > 0) {
      await this.pool.query(
        `UPDATE gateway_stop_controls SET delivered_at = COALESCE(delivered_at, NOW()) WHERE id = ANY($1::bigint[])`,
        [stopRows.map((row) => row.id)],
      );
    }

    return {
      commands: commandRows.map((row) => parseJson<Command>(row.payload_json)),
      stopControls: stopRows.map((row) => parseJson<StopControl>(row.payload_json)),
      updates: updateRows.map((row) => this.toDirectUpdateControl(row)),
      nextCursor: maxId === BigInt(afterId) ? null : maxId.toString(),
    };
  }

  public async ingestDirectWorkerEvents(batch: DirectWorkerEventBatch): Promise<string[]> {
    const client = await this.pool.connect();
    const acceptedEventIds: string[] = [];
    try {
      await client.query("BEGIN");
      const worker = await client.query<WorkerRow>(
        `SELECT id, worker_key, gateway_id, computer_id, transport_type, boot_id
         FROM workers WHERE worker_key = $1 AND transport_type = 'direct-http'`,
        [batch.workerId],
      );
      const workerRow = worker.rows[0];
      if (!workerRow) {
        throw new RepositoryError("UNKNOWN_WORKER", "direct worker has not registered", 404);
      }
      if (workerRow.boot_id !== batch.workerBootId) {
        throw new RepositoryError("STALE_WORKER_BOOT", "worker boot id is stale", 409);
      }

      for (const event of batch.events) {
        const inserted = await client.query<IdRow>(
          `
            INSERT INTO gateway_events (
              event_id, gateway_key, boot_id, worker_key, command_id,
              sequence, event_type, occurred_at, payload_json, transport_type
            )
            VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, 'direct-http')
            ON CONFLICT (event_id) DO NOTHING
            RETURNING event_id AS id
          `,
          [
            event.eventId,
            batch.workerBootId,
            batch.workerId,
            event.commandId ?? null,
            event.sequence,
            event.type,
            new Date(event.occurredAt),
            asJson(event.payload),
          ],
        );
        acceptedEventIds.push(event.eventId);
        if (inserted.rowCount !== null && inserted.rowCount > 0) {
          await this.applyEvent(client, null, event);
        }
      }
      await client.query("UPDATE workers SET online = TRUE, last_seen_at = NOW() WHERE id = $1", [
        workerRow.id,
      ]);
      await client.query("COMMIT");
      return acceptedEventIds;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async enqueueUpdate(request: UpdateRequest): Promise<UpdateRolloutRecord> {
    const separator = request.target.indexOf(":");
    const targetType = request.target.slice(0, separator) as "gateway" | "worker" | "fleet";
    const targetKey = request.target.slice(separator + 1);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<UpdateRow>(
        `SELECT update_id, target, target_type, target_key, gateway_key, transport_type,
                release_version, manifest_url, issued_at, expires_at, status,
                failure_code, failure_message, started_at, completed_at,
                created_at, delivery_cursor
         FROM update_rollouts WHERE update_id = $1`,
        [request.updateId],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (
          row.target !== request.target ||
          row.release_version !== request.releaseVersion ||
          row.manifest_url !== request.manifestUrl
        ) {
          throw new RepositoryError(
            "UPDATE_ID_REUSE",
            "update id is already associated with different rollout data",
            409,
          );
        }
        await client.query("COMMIT");
        return this.toUpdateRecord(row);
      }

      const deliveryTarget = await client.query<{
        gateway_key: string | null;
        transport_type: WorkerTransport;
      }>(
        targetType === "worker"
          ? `
              SELECT g.gateway_key, w.transport_type
              FROM workers w LEFT JOIN gateways g ON g.id = w.gateway_id
              WHERE w.worker_key = $1
            `
          : `SELECT gateway_key, 'gateway-rednet'::text AS transport_type FROM gateways WHERE gateway_key = $1`,
        [targetKey],
      );
      const delivery = deliveryTarget.rows[0];
      if (!delivery || (targetType !== "worker" && !delivery.gateway_key)) {
        throw new RepositoryError(
          targetType === "worker" ? "UNKNOWN_WORKER" : "UNKNOWN_GATEWAY",
          `${targetType} target was not found`,
          404,
        );
      }
      const gatewayKey = delivery.gateway_key;
      const transport = delivery.transport_type;
      if (targetType !== "worker" && transport !== "gateway-rednet") {
        throw new RepositoryError(
          "INVALID_TARGET",
          "only gateway targets can use fleet rollouts",
          400,
        );
      }

      const inserted = await client.query<UpdateRow>(
        `
          INSERT INTO update_rollouts (
            update_id, target, target_type, target_key, gateway_key, transport_type,
            release_version, manifest_url, issued_at, expires_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING update_id, target, target_type, target_key, gateway_key, transport_type,
                    release_version, manifest_url, issued_at, expires_at, status,
                    failure_code, failure_message, started_at, completed_at,
                    created_at, delivery_cursor
        `,
        [
          request.updateId,
          request.target,
          targetType,
          targetKey,
          gatewayKey,
          transport,
          request.releaseVersion,
          request.manifestUrl,
          new Date(request.issuedAt),
          new Date(request.expiresAt),
        ],
      );
      const row = inserted.rows[0];
      if (!row) {
        throw new RepositoryError("INTERNAL_ERROR", "update rollout insert returned no row", 500);
      }
      await client.query(
        `INSERT INTO update_events (update_id, status, message, details_json) VALUES ($1, $2, $3, $4)`,
        [request.updateId, row.status, "rollout queued", asJson({ target: request.target })],
      );
      await client.query("COMMIT");
      return this.toUpdateRecord(row);
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) {
        throw new RepositoryError(
          "UPDATE_OVERLAP",
          "another active update already targets this gateway",
          409,
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async listUpdates(): Promise<readonly UpdateRolloutRecord[]> {
    const result = await this.pool.query<UpdateRow>(
      `
        SELECT update_id, target, target_type, target_key, gateway_key, transport_type,
               release_version, manifest_url, issued_at, expires_at, status,
               failure_code, failure_message, started_at, completed_at,
               created_at, delivery_cursor
        FROM update_rollouts
        ORDER BY created_at DESC, update_id DESC
      `,
    );
    return result.rows.map((row) => this.toUpdateRecord(row));
  }

  public async getUpdate(updateId: string): Promise<UpdateRolloutRecord | undefined> {
    const result = await this.pool.query<UpdateRow>(
      `
        SELECT update_id, target, target_type, target_key, gateway_key, transport_type,
               release_version, manifest_url, issued_at, expires_at, status,
               failure_code, failure_message, started_at, completed_at,
               created_at, delivery_cursor
        FROM update_rollouts
        WHERE update_id = $1
      `,
      [updateId],
    );
    const row = result.rows[0];
    return row ? this.toUpdateRecord(row) : undefined;
  }

  public async ingestEvents(batch: EventBatch): Promise<string[]> {
    const client = await this.pool.connect();
    const acceptedEventIds: string[] = [];
    try {
      await client.query("BEGIN");
      const gateway = await this.findGateway(client, batch.gatewayId);
      if (!gateway) {
        throw new RepositoryError("UNKNOWN_GATEWAY", "gateway has not registered", 404);
      }
      if (gateway.boot_id !== batch.bootId) {
        throw new RepositoryError("STALE_GATEWAY_BOOT", "gateway boot id is stale", 409);
      }

      for (const event of batch.events) {
        const inserted = await client.query<IdRow>(
          `
            INSERT INTO gateway_events (
              event_id, gateway_key, boot_id, worker_key, command_id,
              sequence, event_type, occurred_at, payload_json
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (event_id) DO NOTHING
            RETURNING event_id AS id
          `,
          [
            event.eventId,
            batch.gatewayId,
            batch.bootId,
            event.workerId ?? null,
            event.commandId ?? null,
            event.sequence,
            event.type,
            new Date(event.occurredAt),
            asJson(event.payload),
          ],
        );
        if (inserted.rowCount === 0) {
          acceptedEventIds.push(event.eventId);
          continue;
        }

        acceptedEventIds.push(event.eventId);
        await this.applyEvent(client, gateway.id, event);
      }

      await client.query("UPDATE gateways SET last_seen_at = NOW() WHERE id = $1", [gateway.id]);
      await client.query("COMMIT");
      return acceptedEventIds;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private toUpdateRecord(row: UpdateRow): UpdateRolloutRecord {
    return {
      protocolVersion: 1,
      updateId: row.update_id,
      target: row.target,
      releaseVersion: row.release_version,
      manifestUrl: row.manifest_url,
      issuedAt: new Date(row.issued_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      status: row.status,
      gatewayId: row.gateway_key,
      workerIds: row.target_type === "worker" ? [row.target_key] : [],
      transport: row.transport_type,
      failureCode: row.failure_code,
      failureMessage: row.failure_message,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    };
  }

  private toUpdateControl(row: UpdateRow): UpdateControl {
    return {
      ...this.toUpdateRecord(row),
      gatewayId: row.gateway_key!,
      transport: "gateway-rednet",
    };
  }

  private toDirectUpdateControl(row: UpdateRow): DirectUpdateControl {
    return {
      protocolVersion: 1,
      updateId: row.update_id,
      target: row.target,
      releaseVersion: row.release_version as DirectUpdateControl["releaseVersion"],
      manifestUrl: row.manifest_url,
      issuedAt: new Date(row.issued_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      status: row.status,
      workerId: row.target_key,
      transport: "direct-http",
    };
  }

  public async enqueueCommand(command: Command): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO gateway_commands (
          command_id, task_id, worker_key, payload_json, issued_at, expires_at, transport_type
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          COALESCE((SELECT transport_type FROM workers WHERE worker_key = $3), 'gateway-rednet')
        )
        ON CONFLICT (command_id) DO NOTHING
      `,
      [
        command.commandId,
        command.taskId ?? null,
        command.workerId,
        asJson(command),
        new Date(command.issuedAt),
        new Date(command.expiresAt),
      ],
    );
  }

  public async enqueueStopControl(control: StopControl): Promise<void> {
    let transport: WorkerTransport | null = null;
    if (control.type === "worker.stop") {
      const worker = await this.pool.query<{ transport_type: WorkerTransport }>(
        `SELECT transport_type FROM workers WHERE worker_key = $1`,
        [control.workerId],
      );
      if (!worker.rows[0]) {
        throw new RepositoryError("UNKNOWN_WORKER", "worker is not registered", 404);
      }
      transport = worker.rows[0].transport_type;
    }
    await this.pool.query(
      `
        INSERT INTO gateway_stop_controls (control_id, worker_key, payload_json, transport_type)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (control_id) DO NOTHING
      `,
      [
        control.controlId,
        control.type === "worker.stop" ? control.workerId : null,
        asJson(control),
        transport,
      ],
    );
  }

  public async markStale(now = new Date()): Promise<void> {
    const gatewayCutoff = new Date(
      now.getTime() - this.config.gatewayTimeoutSeconds * 1000,
    ).toISOString();
    const workerCutoff = new Date(
      now.getTime() - this.config.workerTimeoutSeconds * 1000,
    ).toISOString();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE gateways SET status = 'OFFLINE' WHERE last_seen_at IS NULL OR last_seen_at < $1`,
        [gatewayCutoff],
      );
      const staleWorkers = await client.query<{ worker_key: string }>(
        `
          UPDATE workers
          SET online = FALSE
          WHERE online = TRUE
            AND (last_seen_at IS NULL OR last_seen_at < $1
              OR gateway_id IN (SELECT id FROM gateways WHERE status = 'OFFLINE'))
          RETURNING worker_key
        `,
        [workerCutoff],
      );

      for (const worker of staleWorkers.rows) {
        await client.query(
          `
            INSERT INTO audit_events (
              category, worker_id, action_json, result_json, retention_class
            )
            VALUES (
              'worker.recovery.stale',
              (SELECT id FROM workers WHERE worker_key = $1),
              $2, $3, 'HIGH'
            )
          `,
          [
            worker.worker_key,
            asJson({ action: "reconcile-stale-worker", workerId: worker.worker_key }),
            asJson({ outcome: "paused-cancelled-stopped", explicitResumeRequired: true }),
          ],
        );
        await client.query(
          `
            WITH paused AS (
              UPDATE tasks
              SET status = 'PAUSED', assigned_worker_id = NULL,
                  last_error_json = $2
              WHERE assigned_worker_id = (SELECT id FROM workers WHERE worker_key = $1)
                AND status = 'RUNNING'
              RETURNING job_id
            )
            UPDATE jobs
            SET status = 'PAUSED'
            WHERE id IN (SELECT DISTINCT job_id FROM paused)
              AND status IN ('READY', 'RUNNING')
          `,
          [worker.worker_key, asJson({ reason: "worker became stale; explicit resume required" })],
        );
        await client.query(
          `
            UPDATE gateway_commands
            SET status = 'CANCELLED', completed_at = NOW()
            WHERE worker_key = $1
              AND status IN ('QUEUED', 'DELIVERED', 'RUNNING')
          `,
          [worker.worker_key],
        );
        const controlId = `reconcile-stop-${worker.worker_key}`.slice(0, 128);
        const control = {
          protocolVersion: 1,
          controlId,
          issuedAt: now.toISOString(),
          type: "worker.stop",
          workerId: worker.worker_key,
          reason: "worker became stale; stop before explicit resume",
        } satisfies StopControl;
        await client.query(
          `
            INSERT INTO gateway_stop_controls (control_id, worker_key, payload_json, transport_type)
            VALUES ($1, $2, $3, (SELECT transport_type FROM workers WHERE worker_key = $2))
            ON CONFLICT (control_id) DO NOTHING
          `,
          [controlId, worker.worker_key, asJson(control)],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async reconcileControlPlaneRestart(now = new Date()): Promise<{
    readonly workerCount: number;
    readonly commandCount: number;
  }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const affected = await client.query<{
        worker_key: string;
        transport_type: WorkerTransport;
      }>(
        `
          SELECT DISTINCT w.worker_key, w.transport_type
          FROM workers w
          LEFT JOIN tasks task
            ON task.assigned_worker_id = w.id AND task.status = 'RUNNING'
          LEFT JOIN gateway_commands command
            ON command.worker_key = w.worker_key
           AND command.status IN ('QUEUED', 'DELIVERED', 'RUNNING')
          WHERE w.online = TRUE OR task.id IS NOT NULL OR command.id IS NOT NULL
          ORDER BY w.worker_key
        `,
      );
      const workerKeys = affected.rows.map((row) => row.worker_key);
      let commandCount = 0;
      if (workerKeys.length > 0) {
        await client.query(`UPDATE gateways SET status = 'OFFLINE' WHERE status <> 'OFFLINE'`);
        await client.query(`UPDATE workers SET online = FALSE WHERE online = TRUE`);
        await client.query(
          `
            WITH paused AS (
              UPDATE tasks
              SET status = 'PAUSED', assigned_worker_id = NULL,
                  last_error_json = $2
              WHERE assigned_worker_id IN (
                SELECT id FROM workers WHERE worker_key = ANY($1::text[])
              )
                AND status = 'RUNNING'
              RETURNING job_id
            )
            UPDATE jobs
            SET status = 'PAUSED'
            WHERE id IN (SELECT DISTINCT job_id FROM paused)
              AND status IN ('READY', 'RUNNING')
          `,
          [workerKeys, asJson({ reason: "control plane restarted; explicit resume required" })],
        );
        const cancelled = await client.query(
          `
            UPDATE gateway_commands
            SET status = 'CANCELLED', completed_at = NOW()
            WHERE worker_key = ANY($1::text[])
              AND status IN ('QUEUED', 'DELIVERED', 'RUNNING')
          `,
          [workerKeys],
        );
        commandCount = cancelled.rowCount ?? 0;

        for (const worker of affected.rows) {
          const control = {
            protocolVersion: 1,
            controlId: `reconcile-stop-control-plane-${worker.worker_key}-${now.getTime()}`.slice(
              0,
              128,
            ),
            issuedAt: now.toISOString(),
            type: "worker.stop",
            workerId: worker.worker_key,
            reason: "control plane restarted; stop before explicit resume",
          } satisfies StopControl;
          await client.query(
            `
              INSERT INTO gateway_stop_controls (control_id, worker_key, payload_json, transport_type)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (control_id) DO NOTHING
            `,
            [control.controlId, worker.worker_key, asJson(control), worker.transport_type],
          );
          await client.query(
            `
              INSERT INTO audit_events (
                category, worker_id, action_json, result_json, retention_class
              )
              VALUES (
                'control_plane.recovery.restart',
                (SELECT id FROM workers WHERE worker_key = $1),
                $2, $3, 'HIGH'
              )
            `,
            [
              worker.worker_key,
              asJson({ action: "reconcile-control-plane-restart", workerId: worker.worker_key }),
              asJson({ outcome: "paused-cancelled-stopped", explicitResumeRequired: true }),
            ],
          );
        }
      } else {
        await client.query(`UPDATE gateways SET status = 'OFFLINE' WHERE status <> 'OFFLINE'`);
        await client.query(`UPDATE workers SET online = FALSE WHERE online = TRUE`);
      }
      await client.query("COMMIT");
      return { workerCount: workerKeys.length, commandCount };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async listWorkers(): Promise<readonly Record<string, unknown>[]> {
    const result = await this.pool.query(
      `
        SELECT w.worker_key AS "workerId", w.computer_id AS "computerId", w.online,
               w.transport_type AS "transport", w.minecraft_server_id AS "minecraftServerId",
               g.gateway_key AS "gatewayId",
               w.boot_id AS "bootId", w.runtime_version AS "runtimeVersion",
               w.last_seen_at AS "lastSeenAt", w.capabilities_json AS capabilities,
               active_task.task_id AS "currentTaskId"
        FROM workers w
        LEFT JOIN gateways g ON g.id = w.gateway_id
        LEFT JOIN LATERAL (
          SELECT t.id::text AS task_id
          FROM tasks t
          WHERE t.assigned_worker_id = w.id
            AND t.status IN ('RUNNING', 'PAUSED')
          ORDER BY t.started_at DESC NULLS LAST, t.id DESC
          LIMIT 1
        ) active_task ON TRUE
        ORDER BY worker_key
      `,
    );
    return result.rows;
  }

  public async getWorker(workerId: string): Promise<Record<string, unknown> | undefined> {
    const result = await this.pool.query(
      `
        SELECT w.worker_key AS "workerId", w.computer_id AS "computerId", w.online,
               w.transport_type AS "transport", w.minecraft_server_id AS "minecraftServerId",
               g.gateway_key AS "gatewayId",
               w.boot_id AS "bootId", w.runtime_version AS "runtimeVersion",
               w.last_seen_at AS "lastSeenAt", w.capabilities_json AS capabilities,
               active_task.task_id AS "currentTaskId",
               observation.observed_at AS "observedAt",
               observation.dimension, observation.x, observation.y, observation.z,
               observation.facing, observation.position_confidence AS "positionConfidence",
               observation.fuel_level AS "fuelLevel",
               observation.inventory_json AS "inventory",
               observation.current_command_id AS "currentCommandId",
               observation.status AS "observedStatus",
               anchor."anchorDimension", anchor."anchorX", anchor."anchorY", anchor."anchorZ",
               anchor."anchorPositionConfidence"
        FROM workers w
        LEFT JOIN gateways g ON g.id = w.gateway_id
        LEFT JOIN LATERAL (
          SELECT t.id::text AS task_id
          FROM tasks t
          WHERE t.assigned_worker_id = w.id
            AND t.status IN ('RUNNING', 'PAUSED')
          ORDER BY t.started_at DESC NULLS LAST, t.id DESC
          LIMIT 1
        ) active_task ON TRUE
        LEFT JOIN LATERAL (
          SELECT observed_at, dimension, x, y, z, facing, position_confidence,
                 fuel_level, inventory_json, current_command_id, status
          FROM worker_observations
          WHERE worker_id = w.id
          ORDER BY observed_at DESC, id DESC
          LIMIT 1
        ) observation ON TRUE
        LEFT JOIN LATERAL (
          SELECT dimension AS "anchorDimension", x AS "anchorX", y AS "anchorY",
                 z AS "anchorZ", position_confidence AS "anchorPositionConfidence"
          FROM worker_observations
          WHERE worker_id = w.id
            AND position_confidence = 'CONFIRMED_ANCHOR'
          ORDER BY observed_at DESC, id DESC
          LIMIT 1
        ) anchor ON TRUE
        WHERE w.worker_key = $1
      `,
      [workerId],
    );
    const row = result.rows[0] as
      | (Record<string, unknown> & {
          dimension?: number | null;
          x?: number | null;
          y?: number | null;
          z?: number | null;
          facing?: string | null;
          positionConfidence?: string | null;
          fuelLevel?: number | null;
          inventory?: unknown;
          observedAt?: Date | null;
          anchorDimension?: number | null;
          anchorX?: number | null;
          anchorY?: number | null;
          anchorZ?: number | null;
          anchorPositionConfidence?: string | null;
          currentTaskId?: string | null;
          currentCommandId?: string | null;
          observedStatus?: string | null;
        })
      | undefined;
    if (!row) {
      return undefined;
    }

    const hasPosition = row.dimension !== null && row.dimension !== undefined;
    const {
      dimension,
      x,
      y,
      z,
      facing,
      positionConfidence,
      fuelLevel,
      inventory,
      observedAt,
      currentTaskId,
      currentCommandId,
      observedStatus,
      anchorDimension,
      anchorX,
      anchorY,
      anchorZ,
      anchorPositionConfidence,
      ...worker
    } = row;
    const effectiveConfidence = effectivePositionConfidence(
      { dimension, x, y, z, confidence: positionConfidence },
      {
        dimension: anchorDimension,
        x: anchorX,
        y: anchorY,
        z: anchorZ,
        confidence: anchorPositionConfidence,
      },
    );
    return {
      ...worker,
      currentTaskId: currentTaskId ?? null,
      observation: observedAt
        ? {
            observedAt,
            status: observedStatus,
            currentCommandId,
            position: hasPosition
              ? { dimension, x, y, z, facing, confidence: effectiveConfidence }
              : null,
            fuel: fuelLevel === null || fuelLevel === undefined ? null : { level: fuelLevel },
            inventory: inventory ?? null,
          }
        : null,
    };
  }

  public async anchorWorker(
    workerId: string,
    input: WorkerAnchorRequest,
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const worker = await client.query<{ id: string; online: boolean }>(
        `SELECT id::text, online FROM workers WHERE worker_key = $1 FOR UPDATE`,
        [workerId],
      );
      const row = worker.rows[0];
      if (!row) {
        throw new RepositoryError("UNKNOWN_WORKER", "worker was not found", 404);
      }
      const observedAt = new Date();
      await client.query(
        `
          INSERT INTO worker_observations (
            worker_id, observed_at, dimension, x, y, z, facing,
            position_confidence, fuel_level, current_command_id, status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'CONFIRMED_ANCHOR', NULL, NULL, $8)
        `,
        [
          row.id,
          observedAt,
          input.dimension,
          input.x,
          input.y,
          input.z,
          input.facing ?? null,
          row.online ? "ONLINE" : "OFFLINE",
        ],
      );
      await this.recordWalkablePosition(
        client,
        row.id,
        {
          dimension: input.dimension,
          x: input.x,
          y: input.y,
          z: input.z,
        },
        observedAt,
      );
      await client.query("COMMIT");
      return {
        workerId,
        observedAt: observedAt.toISOString(),
        position: {
          dimension: input.dimension,
          x: input.x,
          y: input.y,
          z: input.z,
          facing: input.facing ?? null,
          confidence: "CONFIRMED_ANCHOR",
          source: input.source,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async listGateways(): Promise<readonly Record<string, unknown>[]> {
    const result = await this.pool.query(
      `
        SELECT gateway_key AS "gatewayId", boot_id AS "bootId", minecraft_server_id AS "minecraftServerId",
               runtime_version AS "runtimeVersion", status, last_seen_at AS "lastSeenAt",
               capabilities_json AS capabilities
        FROM gateways
        ORDER BY gateway_key
      `,
    );
    return result.rows;
  }

  private async upsertGateway(
    client: PoolClient,
    gatewayId: string,
    bootId: string,
    values: {
      readonly minecraftServerId?: string;
      readonly runtimeVersion: string | null;
      readonly capabilities: unknown;
      readonly status: "ONLINE" | "DEGRADED";
    },
  ): Promise<GatewayRow> {
    const result = await client.query<GatewayRow>(
      `
        INSERT INTO gateways (
          gateway_key, boot_id, minecraft_server_id, runtime_version,
          status, last_seen_at, capabilities_json
        )
        VALUES ($1, $2, COALESCE($3, 'unknown'), $4, $5, NOW(), $6)
        ON CONFLICT (gateway_key) DO UPDATE
        SET boot_id = EXCLUDED.boot_id,
            minecraft_server_id = COALESCE(EXCLUDED.minecraft_server_id, gateways.minecraft_server_id),
            runtime_version = EXCLUDED.runtime_version,
            status = EXCLUDED.status,
            last_seen_at = NOW(),
            capabilities_json = EXCLUDED.capabilities_json
        RETURNING id, gateway_key, boot_id
      `,
      [
        gatewayId,
        bootId,
        values.minecraftServerId ?? null,
        values.runtimeVersion,
        values.status,
        asJson(values.capabilities),
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new RepositoryError("INTERNAL_ERROR", "gateway upsert returned no row", 500);
    }
    return row;
  }

  private async reconcileGatewayRestart(
    client: PoolClient,
    gatewayId: string,
    gatewayKey: string,
    bootId: string,
  ): Promise<void> {
    const workers = await client.query<{ worker_key: string }>(
      `SELECT worker_key FROM workers WHERE gateway_id = $1 ORDER BY worker_key`,
      [gatewayId],
    );
    const workerKeys = workers.rows.map((row) => row.worker_key);
    if (workerKeys.length > 0) {
      await client.query(
        `
          WITH paused AS (
            UPDATE tasks
            SET status = 'PAUSED', assigned_worker_id = NULL,
                last_error_json = $2
            WHERE assigned_worker_id IN (
              SELECT id FROM workers WHERE gateway_id = $1
            )
              AND status = 'RUNNING'
            RETURNING job_id
          )
          UPDATE jobs
          SET status = 'PAUSED'
          WHERE id IN (SELECT DISTINCT job_id FROM paused)
            AND status IN ('READY', 'RUNNING')
        `,
        [gatewayId, asJson({ reason: "gateway restarted; explicit resume required" })],
      );
      await client.query(
        `
          UPDATE gateway_commands
          SET status = 'CANCELLED', completed_at = NOW()
          WHERE worker_key = ANY($1::text[])
            AND status IN ('QUEUED', 'DELIVERED', 'RUNNING')
        `,
        [workerKeys],
      );
      for (const workerKey of workerKeys) {
        const control = {
          protocolVersion: 1,
          controlId: `reconcile-stop-${gatewayKey}-${workerKey}`.slice(0, 128),
          issuedAt: new Date().toISOString(),
          type: "worker.stop",
          workerId: workerKey,
          reason: "gateway restarted; stop before explicit resume",
        };
        await client.query(
          `
            INSERT INTO gateway_stop_controls (control_id, worker_key, payload_json, transport_type)
            VALUES ($1, $2, $3, 'gateway-rednet')
            ON CONFLICT (control_id) DO NOTHING
          `,
          [control.controlId, workerKey, asJson(control)],
        );
      }
    }
    await client.query(
      `
        INSERT INTO audit_events (
          category, action_json, result_json, retention_class
        )
        VALUES ('gateway.recovery.restart', $1, $2, 'HIGH')
      `,
      [
        asJson({ action: "reconcile-gateway-restart", gatewayId: gatewayKey, bootId }),
        asJson({
          outcome: "paused-cancelled-stopped",
          workerCount: workerKeys.length,
          explicitResumeRequired: workerKeys.length > 0,
        }),
      ],
    );
  }

  private async reconcileWorkerRestart(
    client: PoolClient,
    workerKey: string,
    previousBootId: string,
    bootId: string,
    transportType: WorkerTransport,
  ): Promise<void> {
    await client.query(
      `
        WITH paused AS (
          UPDATE tasks
          SET status = 'PAUSED', assigned_worker_id = NULL,
              last_error_json = $2
          WHERE assigned_worker_id = (SELECT id FROM workers WHERE worker_key = $1)
            AND status = 'RUNNING'
          RETURNING job_id
        )
        UPDATE jobs
        SET status = 'PAUSED'
        WHERE id IN (SELECT DISTINCT job_id FROM paused)
          AND status IN ('READY', 'RUNNING')
      `,
      [workerKey, asJson({ reason: "worker restarted; explicit resume required" })],
    );
    await client.query(
      `
        UPDATE gateway_commands
        SET status = 'CANCELLED', completed_at = NOW()
        WHERE worker_key = $1
          AND transport_type = $2
          AND status IN ('QUEUED', 'DELIVERED', 'RUNNING')
      `,
      [workerKey, transportType],
    );
    const control = {
      protocolVersion: 1,
      controlId: `reconcile-stop-${workerKey}-${bootId}`.slice(0, 128),
      issuedAt: new Date().toISOString(),
      type: "worker.stop",
      workerId: workerKey,
      reason: "worker restarted; stop before explicit resume",
    };
    await client.query(
      `
        INSERT INTO gateway_stop_controls (control_id, worker_key, payload_json, transport_type)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (control_id) DO NOTHING
      `,
      [control.controlId, workerKey, asJson(control), transportType],
    );
    await client.query(
      `
        INSERT INTO audit_events (
          category, worker_id, action_json, result_json, retention_class
        )
        VALUES (
          'worker.recovery.restart',
          (SELECT id FROM workers WHERE worker_key = $1),
          $2, $3, 'HIGH'
        )
      `,
      [
        workerKey,
        asJson({ action: "reconcile-worker-restart", workerId: workerKey, previousBootId, bootId }),
        asJson({ outcome: "paused-cancelled-stopped", explicitResumeRequired: true }),
      ],
    );
  }

  private async findGateway(
    client: Pool | PoolClient,
    gatewayId: string,
  ): Promise<GatewayRow | undefined> {
    const result = await client.query<GatewayRow>(
      `SELECT id, gateway_key, boot_id FROM gateways WHERE gateway_key = $1`,
      [gatewayId],
    );
    return result.rows[0];
  }

  private async upsertWorker(
    client: PoolClient,
    gatewayId: string,
    values: {
      readonly workerKey: string;
      readonly computerId: number;
      readonly runtimeVersion: string;
      readonly capabilities: unknown;
      readonly bootId: string | null;
      readonly online: boolean;
      readonly lastSeenAt: Date;
    },
  ): Promise<WorkerRow> {
    const existing = await client.query<WorkerRow>(
      `SELECT id, worker_key, gateway_id, computer_id, boot_id FROM workers WHERE worker_key = $1`,
      [values.workerKey],
    );
    if (existing.rows[0] && existing.rows[0].gateway_id !== gatewayId) {
      throw new RepositoryError(
        "WORKER_BOUND_ELSEWHERE",
        "worker is already bound to another gateway",
        409,
      );
    }
    if (existing.rows[0]?.boot_id && values.bootId && existing.rows[0].boot_id !== values.bootId) {
      await this.reconcileWorkerRestart(
        client,
        values.workerKey,
        existing.rows[0].boot_id,
        values.bootId,
        "gateway-rednet",
      );
    }

    const result = await client.query<WorkerRow>(
      `
        INSERT INTO workers (
          worker_key, gateway_id, computer_id, online, boot_id,
          runtime_version, last_seen_at, capabilities_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (worker_key) DO UPDATE
        SET gateway_id = EXCLUDED.gateway_id,
            computer_id = EXCLUDED.computer_id,
            online = EXCLUDED.online,
            boot_id = EXCLUDED.boot_id,
            runtime_version = EXCLUDED.runtime_version,
            last_seen_at = EXCLUDED.last_seen_at,
            capabilities_json = EXCLUDED.capabilities_json
        RETURNING id, worker_key, gateway_id, computer_id
      `,
      [
        values.workerKey,
        gatewayId,
        values.computerId,
        values.online,
        values.bootId,
        values.runtimeVersion,
        values.lastSeenAt,
        asJson(values.capabilities),
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new RepositoryError("INTERNAL_ERROR", "worker upsert returned no row", 500);
    }
    return row;
  }

  private async advanceGatherWorkflow(client: PoolClient, event: Event): Promise<void> {
    if (
      !event.commandId ||
      (event.type !== "command.completed" && event.type !== "command.failed")
    ) {
      return;
    }

    const taskResult = await client.query<{
      task_id: string;
      parent_task_id: string | null;
      workflow_phase: string | null;
      status: string;
      job_id: string;
    }>(
      `
        SELECT t.id::text AS task_id, t.parent_task_id::text AS parent_task_id,
               t.workflow_phase, t.status, t.job_id::text AS job_id
        FROM gateway_commands command
        JOIN tasks t ON t.id = command.task_id
        WHERE command.command_id = $1
      `,
      [event.commandId],
    );
    const task = taskResult.rows[0];
    const inventoryFull = isInventoryFullFailure(event) && task?.workflow_phase === "GATHER";
    if (
      !task?.parent_task_id ||
      (!workflowStepEventCanAdvance(task.status, event.type) && !inventoryFull)
    ) {
      return;
    }

    const parentResult = await client.query<{ arguments_json: unknown }>(
      `SELECT arguments_json FROM tasks WHERE id = $1`,
      [task.parent_task_id],
    );
    const parentArguments = parseJson<Record<string, unknown>>(
      parentResult.rows[0]?.arguments_json ?? {},
    );
    const block = async (reason: string): Promise<void> => {
      await client.query(
        `
          UPDATE tasks
          SET status = 'BLOCKED', assigned_worker_id = NULL, last_error_json = $2
          WHERE id = $1 AND status IN ('READY', 'RUNNING')
        `,
        [task.parent_task_id, asJson({ reason })],
      );
      await client.query(
        `UPDATE jobs SET status = 'BLOCKED' WHERE id = $1 AND status IN ('READY', 'RUNNING')`,
        [task.job_id],
      );
    };

    if (event.type === "command.failed") {
      if (inventoryFull) {
        const recovery = inventoryFullRecoveryPlan(event, parentArguments);
        if (recovery && event.workerId) {
          const failedPayload = isRecord(event.payload)
            ? (event.payload as Record<string, unknown>)
            : undefined;
          let position = coordinateFromUnknown(failedPayload?.position);
          if (!position) {
            const positionResult = await client.query<{
              dimension: number | null;
              x: number | null;
              y: number | null;
              z: number | null;
            }>(
              `
                SELECT dimension, x, y, z
                FROM worker_observations
                WHERE worker_id = (SELECT id FROM workers WHERE worker_key = $1)
                  AND dimension IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL AND z IS NOT NULL
                ORDER BY observed_at DESC, id DESC
                LIMIT 1
              `,
              [event.workerId],
            );
            position = coordinateFromUnknown(positionResult.rows[0]);
          }
          if (
            position &&
            (await this.queueGatherDelivery(client, {
              jobId: task.job_id,
              parentTaskId: task.parent_task_id,
              targetWorkerId: recovery.targetWorkerId,
              itemKey: recovery.itemKey,
              destination: recovery.destination,
              position,
              depositQuantity: recovery.depositQuantity,
              remainingQuantity: recovery.quantity - recovery.depositQuantity,
              resumeGatherAfterDeposit: true,
            }))
          ) {
            return;
          }
        }
        const reason =
          "worker inventory is full; automatic return-to-container was unavailable; deposit items, then explicitly resume the gather task";
        await client.query(
          `
            UPDATE tasks
            SET status = 'PAUSED', assigned_worker_id = NULL, last_error_json = $2
            WHERE id = $1 AND status IN ('READY', 'RUNNING', 'PAUSED')
          `,
          [task.parent_task_id, asJson({ reason, resumable: true })],
        );
        await client.query(
          `UPDATE jobs SET status = 'PAUSED' WHERE id = $1 AND status IN ('READY', 'RUNNING', 'PAUSED')`,
          [task.job_id],
        );
        return;
      }
      if (task.workflow_phase === "NAVIGATE") {
        const blocked = blockedMovementForReplan(event);
        if (
          blocked &&
          (await this.replanGatherNavigation(
            client,
            { parent_task_id: task.parent_task_id!, job_id: task.job_id },
            parentArguments,
            blocked,
          ))
        ) {
          return;
        }
        await block("navigation was blocked and no bounded replan was available");
        return;
      }
      await block(`workflow step failed: ${task.workflow_phase ?? "unknown"}`);
      return;
    }
    if (task.workflow_phase === "GATHER") {
      const targetWorkerId = parentArguments.targetWorkerId;
      const destination = parentArguments.destination;
      const itemKey = parentArguments.itemKey;
      const quantity = parentArguments.quantity;
      const eventPayload = isRecord(event.payload)
        ? (event.payload as Record<string, unknown>)
        : {};
      const position = coordinateFromUnknown(eventPayload.position);
      if (
        typeof targetWorkerId !== "string" ||
        typeof destination !== "string" ||
        typeof itemKey !== "string" ||
        typeof quantity !== "number" ||
        !Number.isSafeInteger(quantity) ||
        !position ||
        !gatherResultMeetsTarget(eventPayload.result, itemKey, quantity)
      ) {
        await block(
          "gather workflow lacks verified requested item, quantity, worker, or goal position",
        );
        return;
      }

      const locationResult = await client.query<{
        name: string;
        dimension: number;
        x: number;
        y: number;
        z: number;
        approach: unknown;
      }>(
        `SELECT name, dimension, x, y, z, approach_json AS approach
         FROM named_locations WHERE LOWER(name) = LOWER($1) LIMIT 1`,
        [destination.trim()],
      );
      const location = locationResult.rows[0];
      const target = coordinateFromUnknown(location?.approach) ?? coordinateFromUnknown(location);
      if (!target || target.dimension !== position.dimension) {
        await block("gather destination is not a known location in the worker dimension");
        return;
      }

      const world = new SparseWorldModel();
      const worldResult = await client.query<{
        dimension: number;
        x: number;
        y: number;
        z: number;
        walkable: boolean;
        observed_at: Date;
        source_worker_id: string | null;
      }>(
        `
          SELECT dimension, x, y, z, walkable, observed_at, source_worker_id::text
          FROM world_cells
          WHERE observed_at >= NOW() - ($1::text || ' seconds')::interval
          LIMIT 10000
        `,
        [this.config.worldCellMaxAgeSeconds],
      );
      for (const cell of worldResult.rows) {
        world.setCell({
          dimension: cell.dimension,
          x: cell.x,
          y: cell.y,
          z: cell.z,
          walkable: cell.walkable,
          observedAt: cell.observed_at.toISOString(),
          source: cell.source_worker_id ?? "unknown",
        });
      }
      const path = findKnownPath(world, position, target, { maxNodes: 10_000 });
      if (!path) {
        await block("gather destination has no safe path through known walkable cells");
        return;
      }
      const containerId = normalizeContainerId(destination);
      if (!containerId) {
        await block("gather destination cannot be converted to a safe container ID");
        return;
      }
      await client.query(`UPDATE tasks SET status = 'RUNNING' WHERE id = $1 AND status = 'READY'`, [
        task.parent_task_id,
      ]);
      const nextStep = await client.query(
        `SELECT 1 FROM tasks WHERE parent_task_id = $1 AND workflow_phase = $2 LIMIT 1`,
        [task.parent_task_id, path.directions.length > 0 ? "NAVIGATE" : "DEPOSIT"],
      );
      if (nextStep.rowCount) return;
      if (path.directions.length > 0) {
        await client.query(
          `
            INSERT INTO tasks (
              job_id, kind, status, skill_name, arguments_json, parent_task_id, workflow_phase
            )
            VALUES ($1, 'workflow-step', 'READY', 'navigate.path', $2, $3, 'NAVIGATE')
          `,
          [task.job_id, asJson({ targetWorkerId, steps: path.directions }), task.parent_task_id],
        );
      } else {
        await client.query(
          `
            INSERT INTO tasks (
              job_id, kind, status, skill_name, arguments_json, parent_task_id, workflow_phase
            )
            VALUES ($1, 'workflow-step', 'READY', 'inventory.deposit', $2, $3, 'DEPOSIT')
          `,
          [
            task.job_id,
            asJson({ targetWorkerId, containerId, itemKey, quantity }),
            task.parent_task_id,
          ],
        );
      }
      return;
    }

    if (task.workflow_phase === "NAVIGATE") {
      const targetWorkerId = parentArguments.targetWorkerId;
      const destination = parentArguments.destination;
      const itemKey = parentArguments.itemKey;
      const quantity = parentArguments.quantity;
      const pendingDepositQuantity = integerArgument(parentArguments, "pendingDepositQuantity", 0);
      const remainingQuantity = integerArgument(parentArguments, "remainingQuantity", 0);
      const containerId =
        typeof destination === "string" ? normalizeContainerId(destination) : undefined;
      if (
        typeof targetWorkerId !== "string" ||
        typeof itemKey !== "string" ||
        typeof quantity !== "number" ||
        !Number.isSafeInteger(quantity) ||
        !containerId
      ) {
        await block("gather destination container configuration is invalid");
        return;
      }
      await client.query(`UPDATE tasks SET status = 'RUNNING' WHERE id = $1 AND status = 'READY'`, [
        task.parent_task_id,
      ]);
      const nextStep = await client.query(
        `SELECT 1 FROM tasks WHERE parent_task_id = $1 AND workflow_phase = 'DEPOSIT' LIMIT 1`,
        [task.parent_task_id],
      );
      if (nextStep.rowCount) return;
      await client.query(
        `
          INSERT INTO tasks (
            job_id, kind, status, skill_name, arguments_json, parent_task_id, workflow_phase
          )
          VALUES ($1, 'workflow-step', 'READY', 'inventory.deposit', $2, $3, 'DEPOSIT')
        `,
        [
          task.job_id,
          asJson({
            targetWorkerId,
            containerId,
            itemKey,
            quantity:
              parentArguments.resumeGatherAfterDeposit === true && pendingDepositQuantity > 0
                ? pendingDepositQuantity
                : remainingQuantity > 0
                  ? remainingQuantity
                  : quantity,
          }),
          task.parent_task_id,
        ],
      );
      return;
    }

    if (task.workflow_phase === "DEPOSIT") {
      const eventPayload = isRecord(event.payload)
        ? (event.payload as Record<string, unknown>)
        : {};
      const result = eventPayload.result;
      const configuredQuantity = parentArguments.quantity;
      const itemKey = parentArguments.itemKey;
      const remainingQuantity = integerArgument(parentArguments, "remainingQuantity", 0);
      const requestedQuantity = remainingQuantity > 0 ? remainingQuantity : configuredQuantity;
      const pendingDepositQuantity = integerArgument(parentArguments, "pendingDepositQuantity", 0);
      const depositQuantity =
        parentArguments.resumeGatherAfterDeposit === true && pendingDepositQuantity > 0
          ? pendingDepositQuantity
          : requestedQuantity;
      if (
        typeof depositQuantity !== "number" ||
        !Number.isSafeInteger(depositQuantity) ||
        typeof itemKey !== "string" ||
        !transferMeetsQuantity(result, depositQuantity, itemKey)
      ) {
        await block("deposit completed without transferring the requested quantity");
        return;
      }
      const transferEvidence = await client.query(
        `
          SELECT 1
          FROM gateway_events
          WHERE command_id = $1
            AND event_type = 'inventory.changed'
          LIMIT 1
        `,
        [event.commandId],
      );
      if (!transferEvidence.rowCount) {
        await block("deposit completed without post-transfer inventory evidence");
        return;
      }
      if (parentArguments.resumeGatherAfterDeposit === true) {
        const targetWorkerId = parentArguments.targetWorkerId;
        const itemKey = parentArguments.itemKey;
        if (typeof targetWorkerId !== "string" || typeof itemKey !== "string") {
          await block("gather resume lacks a complete worker or item key");
          return;
        }
        if (remainingQuantity < 1) {
          await client.query(
            `
              UPDATE tasks
              SET status = 'DONE', assigned_worker_id = NULL, last_error_json = NULL
              WHERE id = $1
            `,
            [task.parent_task_id],
          );
          await client.query(
            `UPDATE jobs SET status = 'DONE' WHERE id = $1 AND status IN ('READY', 'RUNNING')`,
            [task.job_id],
          );
          await client.query(
            `
              UPDATE projects
              SET status = 'COMPLETED'
              WHERE id = (SELECT project_id FROM jobs WHERE id = $1)
                AND status IN ('ACTIVE', 'PLANNING')
            `,
            [task.job_id],
          );
          return;
        }
        const activeGather = await client.query(
          `
            SELECT 1
            FROM tasks
            WHERE parent_task_id = $1
              AND workflow_phase = 'GATHER'
              AND status IN ('READY', 'RUNNING')
            LIMIT 1
          `,
          [task.parent_task_id],
        );
        if (activeGather.rowCount) return;
        await client.query(
          `
            UPDATE tasks
            SET status = 'RUNNING',
                arguments_json = arguments_json - 'pendingDepositQuantity' - 'resumeGatherAfterDeposit',
                last_error_json = NULL
            WHERE id = $1
          `,
          [task.parent_task_id],
        );
        await client.query(
          `
            INSERT INTO tasks (
              job_id, kind, status, skill_name, arguments_json, parent_task_id, workflow_phase
            )
            VALUES ($1, 'workflow-step', 'READY', 'mining.gather', $2, $3, 'GATHER')
          `,
          [
            task.job_id,
            asJson({ targetWorkerId, itemKey, quantity: remainingQuantity, maxDepth: 64 }),
            task.parent_task_id,
          ],
        );
        return;
      }
      await client.query(
        `
          UPDATE tasks
          SET status = 'DONE', assigned_worker_id = NULL, last_error_json = NULL
          WHERE id = $1
        `,
        [task.parent_task_id],
      );
      await client.query(
        `UPDATE jobs SET status = 'DONE' WHERE id = $1 AND status IN ('READY', 'RUNNING')`,
        [task.job_id],
      );
      await client.query(
        `
          UPDATE projects
          SET status = 'COMPLETED'
          WHERE id = (SELECT project_id FROM jobs WHERE id = $1)
            AND status IN ('ACTIVE', 'PLANNING')
        `,
        [task.job_id],
      );
    }
  }

  private async replanGatherNavigation(
    client: PoolClient,
    task: {
      readonly parent_task_id: string;
      readonly job_id: string;
    },
    parentArguments: Record<string, unknown>,
    blocked: { readonly position: Coordinate; readonly direction: string },
  ): Promise<boolean> {
    const targetWorkerId = parentArguments.targetWorkerId;
    const destination = parentArguments.destination;
    const currentReplans = Math.max(
      0,
      integerArgument(parentArguments, "navigationReplanCount", 0),
    );
    if (
      typeof targetWorkerId !== "string" ||
      typeof destination !== "string" ||
      currentReplans >= 3
    ) {
      return false;
    }

    const active = await client.query(
      `
        SELECT 1
        FROM tasks
        WHERE parent_task_id = $1
          AND workflow_phase = 'NAVIGATE'
          AND status IN ('READY', 'RUNNING')
        LIMIT 1
      `,
      [task.parent_task_id],
    );
    if (active.rowCount) return true;

    const locationResult = await client.query<{
      dimension: number;
      x: number;
      y: number;
      z: number;
      approach: unknown;
    }>(
      `
        SELECT dimension, x, y, z, approach_json AS approach
        FROM named_locations
        WHERE LOWER(name) = LOWER($1)
        LIMIT 1
      `,
      [destination.trim()],
    );
    const location = locationResult.rows[0];
    const target = coordinateFromUnknown(location?.approach) ?? coordinateFromUnknown(location);
    if (!target || target.dimension !== blocked.position.dimension) return false;

    const world = new SparseWorldModel();
    const worldResult = await client.query<{
      dimension: number;
      x: number;
      y: number;
      z: number;
      walkable: boolean;
      observed_at: Date;
      source_worker_id: string | null;
    }>(
      `
        SELECT dimension, x, y, z, walkable, observed_at, source_worker_id::text
        FROM world_cells
        WHERE observed_at >= NOW() - ($1::text || ' seconds')::interval
        LIMIT 10000
      `,
      [this.config.worldCellMaxAgeSeconds],
    );
    for (const cell of worldResult.rows) {
      world.setCell({
        dimension: cell.dimension,
        x: cell.x,
        y: cell.y,
        z: cell.z,
        walkable: cell.walkable,
        observedAt: cell.observed_at.toISOString(),
        source: cell.source_worker_id ?? "unknown",
      });
    }
    const blockedCell = movedCoordinate(blocked.position, blocked.direction);
    if (blockedCell) {
      world.setCell({
        ...blockedCell,
        walkable: false,
        observedAt: new Date().toISOString(),
        source: targetWorkerId,
      });
    }
    const path = findKnownPath(world, blocked.position, target, { maxNodes: 10_000 });
    if (!path || path.directions.length < 1 || path.directions.length > 1024) return false;

    const nextReplanCount = currentReplans + 1;
    await client.query(
      `
        UPDATE tasks
        SET status = 'RUNNING',
            arguments_json = jsonb_set(arguments_json, '{navigationReplanCount}', to_jsonb($2::int), true),
            last_error_json = $3
        WHERE id = $1
      `,
      [
        task.parent_task_id,
        nextReplanCount,
        asJson({
          reason: "navigation blocked; bounded replan queued",
          replanCount: nextReplanCount,
        }),
      ],
    );
    await client.query(
      `
        INSERT INTO tasks (
          job_id, kind, status, skill_name, arguments_json, parent_task_id, workflow_phase
        )
        VALUES ($1, 'workflow-step', 'READY', 'navigate.path', $2, $3, 'NAVIGATE')
      `,
      [task.job_id, asJson({ targetWorkerId, steps: path.directions }), task.parent_task_id],
    );
    return true;
  }

  private async applyEvent(
    client: PoolClient,
    gatewayId: string | null,
    event: Event,
  ): Promise<void> {
    if (event.workerId) {
      const worker = await client.query<WorkerRow>(
        `SELECT id, worker_key, gateway_id, computer_id, transport_type, minecraft_server_id, boot_id
         FROM workers WHERE worker_key = $1`,
        [event.workerId],
      );
      const workerRow = worker.rows[0];
      const identityMatches =
        workerRow &&
        (gatewayId === null
          ? workerRow.transport_type === "direct-http" && workerRow.gateway_id === null
          : workerRow.transport_type === "gateway-rednet" && workerRow.gateway_id === gatewayId);
      if (!identityMatches) {
        throw new RepositoryError(
          "UNKNOWN_WORKER",
          `worker ${event.workerId} is not registered`,
          404,
        );
      }

      if (event.type === "worker.online") {
        const payload = event.payload as {
          readonly workerBootId: string;
          readonly computerId: number;
          readonly runtimeVersion: string;
          readonly capabilities: unknown;
        };
        await client.query(
          `
            UPDATE workers
            SET online = TRUE, boot_id = $2, computer_id = $3,
                runtime_version = $4, capabilities_json = $5, last_seen_at = $6
            WHERE id = $1
          `,
          [
            workerRow.id,
            payload.workerBootId,
            payload.computerId,
            payload.runtimeVersion,
            asJson(payload.capabilities),
            new Date(event.occurredAt),
          ],
        );
      } else if (event.type === "worker.offline") {
        await client.query(`UPDATE workers SET online = FALSE, last_seen_at = $2 WHERE id = $1`, [
          workerRow.id,
          new Date(event.occurredAt),
        ]);
      }
    }

    if (event.type === "worker.state") {
      const payload = event.payload as {
        readonly position: {
          readonly dimension: number;
          readonly x: number;
          readonly y: number;
          readonly z: number;
          readonly facing: string;
          readonly confidence: string;
        } | null;
        readonly fuel: { readonly level?: number | null } | null;
        readonly currentCommandId: string | null;
        readonly state: string;
      };
      const workerId = event.workerId;
      if (!workerId) {
        return;
      }
      const worker = await client.query<WorkerRow>(
        `SELECT id, worker_key, gateway_id, computer_id, transport_type, minecraft_server_id, boot_id
         FROM workers WHERE worker_key = $1`,
        [workerId],
      );
      const workerRow = worker.rows[0];
      if (!workerRow) {
        return;
      }
      await client.query(
        `
          INSERT INTO worker_observations (
            worker_id, observed_at, dimension, x, y, z, facing,
            position_confidence, fuel_level, current_command_id, status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          workerRow.id,
          new Date(event.occurredAt),
          payload.position?.dimension ?? null,
          payload.position?.x ?? null,
          payload.position?.y ?? null,
          payload.position?.z ?? null,
          payload.position?.facing ?? null,
          storedPositionConfidence(payload.position?.confidence),
          payload.fuel?.level ?? null,
          payload.currentCommandId,
          payload.state === "IDLE" ? "ONLINE" : "ONLINE",
        ],
      );
      if (payload.position) {
        await client.query(
          `
            INSERT INTO world_cells (
              dimension, x, y, z, block_name, block_metadata, walkable, observed_at, source_worker_id
            )
            VALUES ($1, $2, $3, $4, NULL, NULL, TRUE, $5, $6)
            ON CONFLICT (dimension, x, y, z) DO UPDATE SET
              walkable = TRUE,
              observed_at = EXCLUDED.observed_at,
              source_worker_id = EXCLUDED.source_worker_id
            WHERE world_cells.observed_at <= EXCLUDED.observed_at
          `,
          [
            payload.position.dimension,
            payload.position.x,
            payload.position.y,
            payload.position.z,
            new Date(event.occurredAt),
            workerRow.id,
          ],
        );
      }
    }

    if (event.type === "movement.blocked" && event.workerId) {
      const payload = event.payload as {
        readonly direction?: string;
        readonly position?: {
          readonly dimension: number;
          readonly x: number;
          readonly y: number;
          readonly z: number;
          readonly facing?: string;
        };
      };
      const position = coordinateFromUnknown(payload.position);
      const blocked = position && movedCoordinate(position, payload.direction ?? "");
      if (blocked) {
        const worker = await client.query<{ id: string }>(
          `SELECT id::text FROM workers WHERE worker_key = $1`,
          [event.workerId],
        );
        await client.query(
          `
            INSERT INTO world_cells (
              dimension, x, y, z, block_name, block_metadata, walkable, observed_at, source_worker_id
            )
            VALUES ($1, $2, $3, $4, NULL, NULL, FALSE, $5, $6)
            ON CONFLICT (dimension, x, y, z) DO UPDATE SET
              walkable = FALSE,
              observed_at = EXCLUDED.observed_at,
              source_worker_id = EXCLUDED.source_worker_id
            WHERE world_cells.observed_at <= EXCLUDED.observed_at
          `,
          [
            blocked.dimension,
            blocked.x,
            blocked.y,
            blocked.z,
            new Date(event.occurredAt),
            worker.rows[0]?.id ?? null,
          ],
        );
      }
    }

    if (event.type === "inventory.changed" && event.workerId) {
      const payload = event.payload as { readonly slots: unknown[] };
      await this.recordInventorySnapshot(
        client,
        event.workerId,
        payload.slots,
        new Date(event.occurredAt),
      );
    }

    const inspectedInventory = inventorySlotsFromCommandEvent(event);
    if (event.workerId && inspectedInventory) {
      await this.recordInventorySnapshot(
        client,
        event.workerId,
        inspectedInventory,
        new Date(event.occurredAt),
      );
    }

    if (event.type === "block.observed" && event.workerId) {
      const payload = event.payload as {
        readonly direction: "front" | "up" | "down";
        readonly block: { readonly name: string; readonly metadata?: number } | null;
        readonly position?: {
          readonly dimension: number;
          readonly x: number;
          readonly y: number;
          readonly z: number;
          readonly facing: "N" | "E" | "S" | "W";
        };
      };
      if (payload.position) {
        let xOffset = 0;
        let zOffset = 0;
        if (payload.direction === "front") {
          if (payload.position.facing === "N") zOffset = -1;
          if (payload.position.facing === "E") xOffset = 1;
          if (payload.position.facing === "S") zOffset = 1;
          if (payload.position.facing === "W") xOffset = -1;
        }
        const yOffset = payload.direction === "up" ? 1 : payload.direction === "down" ? -1 : 0;
        const worker = await client.query<{ id: string }>(
          `SELECT id::text FROM workers WHERE worker_key = $1`,
          [event.workerId],
        );
        await client.query(
          `
            INSERT INTO world_cells (
              dimension, x, y, z, block_name, block_metadata, walkable, observed_at, source_worker_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (dimension, x, y, z) DO UPDATE SET
              block_name = EXCLUDED.block_name,
              block_metadata = EXCLUDED.block_metadata,
              walkable = EXCLUDED.walkable,
              observed_at = EXCLUDED.observed_at,
              source_worker_id = EXCLUDED.source_worker_id
            WHERE world_cells.observed_at <= EXCLUDED.observed_at
          `,
          [
            payload.position.dimension,
            payload.position.x + xOffset,
            payload.position.y + yOffset,
            payload.position.z + zOffset,
            payload.block?.name ?? null,
            payload.block?.metadata ?? null,
            payload.block === null,
            new Date(event.occurredAt),
            worker.rows[0]?.id ?? null,
          ],
        );
      }
    }

    const commandStatus = commandStatusForEvent(event.type);
    if (commandStatus && event.commandId) {
      await client.query(
        `
          UPDATE gateway_commands
          SET status = $2, completed_at = CASE WHEN $2 IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN NOW() ELSE completed_at END
          WHERE command_id = $1
        `,
        [event.commandId, commandStatus],
      );
      const taskStatus = taskStatusForCommandEvent(event.type);
      if (taskStatus) {
        const inventoryFull = isInventoryFullFailure(event);
        await client.query(
          `
            UPDATE tasks
            SET status = $2, assigned_worker_id = NULL,
                last_error_json = CASE WHEN $3::text IS NULL THEN last_error_json ELSE $3::jsonb END
            WHERE id = (SELECT task_id FROM gateway_commands WHERE command_id = $1)
              AND status = 'RUNNING'
          `,
          [
            event.commandId,
            inventoryFull ? "PAUSED" : taskStatus,
            taskStatus === "DONE"
              ? null
              : inventoryFull
                ? asJson({
                    reason:
                      "worker inventory is full; deposit items, then explicitly resume the gather task",
                    resumable: true,
                  })
                : asJson({ reason: event.type }),
          ],
        );
        await this.advanceGatherWorkflow(client, event);
      }
    }

    const updateStatus = updateStatusForEvent(event.type);
    if (updateStatus) {
      const payload = event.payload as {
        readonly updateId: string;
        readonly message?: string;
      };
      await client.query(
        `
          UPDATE update_rollouts
          SET status = $2,
              failure_code = CASE WHEN $2 IN ('FAILED', 'ROLLED_BACK') THEN $3 ELSE failure_code END,
              failure_message = CASE WHEN $2 IN ('FAILED', 'ROLLED_BACK') THEN $4 ELSE failure_message END,
              started_at = CASE WHEN $2 IN ('RUNNING', 'CANARY') THEN COALESCE(started_at, NOW()) ELSE started_at END,
              completed_at = CASE WHEN $2 IN ('SUCCEEDED', 'FAILED', 'ROLLED_BACK', 'CANCELLED') THEN NOW() ELSE completed_at END
          WHERE update_id = $1
        `,
        [
          payload.updateId,
          updateStatus,
          updateStatus === "ROLLED_BACK"
            ? "ROLLBACK"
            : updateStatus === "FAILED"
              ? "UPDATE_FAILED"
              : null,
          payload.message ?? null,
        ],
      );
      await client.query(
        `INSERT INTO update_events (update_id, status, message, details_json) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [
          payload.updateId,
          updateStatus,
          payload.message ?? null,
          asJson({ eventId: event.eventId }),
        ],
      );
    }

    await this.recordPlannerTrigger(client, event);
  }

  private parseCursor(value: string): number {
    if (!/^[0-9]+$/.test(value)) {
      throw new RepositoryError("INVALID_CURSOR", "after cursor must be a decimal identifier", 400);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new RepositoryError("INVALID_CURSOR", "after cursor is out of range", 400);
    }
    return parsed;
  }
}

export class RepositoryError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

export interface AgentRecord {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly workerBindingId: string | null;
}

export class AgentGroupRepository {
  public constructor(private readonly pool: Pool) {}

  public async createAgent(name: string, capabilityPolicyId = "default"): Promise<AgentRecord> {
    const result = await this.pool.query<AgentRecord>(
      `
        INSERT INTO agents (name, capability_policy_id)
        VALUES ($1, $2)
        RETURNING id::text, name, enabled, worker_binding_id::text AS "workerBindingId"
      `,
      [name, capabilityPolicyId],
    );
    return result.rows[0]!;
  }

  public async getAgent(name: string): Promise<AgentRecord | null> {
    const result = await this.pool.query<AgentRecord>(
      `
        SELECT id::text, name, enabled, worker_binding_id::text AS "workerBindingId"
        FROM agents WHERE name = $1
      `,
      [name],
    );
    return result.rows[0] ?? null;
  }

  public async setAgentEnabled(name: string, enabled: boolean): Promise<void> {
    await this.pool.query(`UPDATE agents SET enabled = $2 WHERE name = $1`, [name, enabled]);
  }

  public async bindAgentToWorker(agentName: string, workerKey: string): Promise<void> {
    await this.pool.query(
      `
        UPDATE agents
        SET worker_binding_id = (SELECT id FROM workers WHERE worker_key = $2)
        WHERE name = $1
          AND EXISTS (SELECT 1 FROM workers WHERE worker_key = $2)
      `,
      [agentName, workerKey],
    );
  }

  public async createGroup(name: string, purpose: string): Promise<string> {
    const result = await this.pool.query<IdRow>(
      `INSERT INTO groups (name, purpose) VALUES ($1, $2) RETURNING id::text`,
      [name, purpose],
    );
    return result.rows[0]!.id;
  }

  public async setGroupMembership(
    groupId: string,
    agentId: string,
    member: boolean,
  ): Promise<void> {
    if (member) {
      await this.pool.query(
        `INSERT INTO group_members (group_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [groupId, agentId],
      );
    } else {
      await this.pool.query(`DELETE FROM group_members WHERE group_id = $1 AND agent_id = $2`, [
        groupId,
        agentId,
      ]);
    }
  }
}

const taskTransitions: Record<string, readonly string[]> = {
  PENDING: ["READY", "CANCELLED"],
  READY: ["RUNNING", "PAUSED", "CANCELLED"],
  RUNNING: ["DONE", "FAILED", "BLOCKED", "PAUSED", "CANCELLED"],
  PAUSED: ["READY", "CANCELLED"],
  BLOCKED: ["READY", "CANCELLED"],
  DONE: [],
  FAILED: ["READY", "CANCELLED"],
  CANCELLED: [],
};

export class TaskRepository {
  public constructor(private readonly pool: Pool) {}

  private static readonly taskProjection = `
    SELECT t.id::text AS "taskId", t.job_id::text AS "jobId",
           t.parent_task_id::text AS "parentTaskId", t.workflow_phase AS "workflowPhase",
           t.kind, t.status, t.skill_name AS "skillName", t.arguments_json AS arguments,
           t.assigned_worker_id::text AS "assignedWorkerId", t.claimed_at AS "claimedAt",
           t.started_at AS "startedAt", t.attempt_count AS "attemptCount",
           j.priority, j.required_capabilities_json AS "requiredCapabilities",
           p.goal_text AS "goalText", t.last_error_json AS "lastError"
    FROM tasks t
    JOIN jobs j ON j.id = t.job_id
    JOIN projects p ON p.id = j.project_id
  `;

  public async listTasks(): Promise<readonly Record<string, unknown>[]> {
    const result = await this.pool.query(
      `
        ${TaskRepository.taskProjection}
        ORDER BY t.id DESC
      `,
    );
    return result.rows;
  }

  public async getTask(taskId: string): Promise<Record<string, unknown> | undefined> {
    const result = await this.pool.query(
      `
        ${TaskRepository.taskProjection}
        WHERE t.id = $1
      `,
      [taskId],
    );
    return result.rows[0];
  }

  public async claimReadyTask(taskId: string, workerKey: string): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const worker = await client.query<{ id: string; online: boolean }>(
        `SELECT id::text, online FROM workers WHERE worker_key = $1 FOR UPDATE`,
        [workerKey],
      );
      const workerRow = worker.rows[0];
      if (!workerRow) {
        throw new RepositoryError("UNKNOWN_WORKER", "worker was not found", 404);
      }
      if (!workerRow.online) {
        throw new RepositoryError("WORKER_OFFLINE", "worker is not online", 409);
      }

      const active = await client.query(
        `
          SELECT 1 FROM tasks
          WHERE assigned_worker_id = $1
            AND status IN ('RUNNING', 'PAUSED')
          LIMIT 1
        `,
        [workerRow.id],
      );
      if (active.rowCount) {
        throw new RepositoryError("WORKER_BUSY", "worker already has active task", 409);
      }

      const task = await client.query(
        `
          UPDATE tasks t
          SET status = 'RUNNING', assigned_worker_id = $2, claimed_at = NOW(), started_at = NOW(),
              attempt_count = t.attempt_count + 1
          WHERE t.id = $1
            AND t.status = 'READY'
            AND t.assigned_worker_id IS NULL
            AND (
              t.arguments_json->>'targetWorkerId' IS NULL
              OR t.arguments_json->>'targetWorkerId' = $3
            )
            AND NOT EXISTS (
              SELECT 1
              FROM task_dependencies dependency_link
              JOIN tasks dependency ON dependency.id = dependency_link.depends_on_task_id
              WHERE dependency_link.task_id = t.id
                AND dependency.status <> 'DONE'
            )
          RETURNING t.id::text AS "taskId", t.job_id::text AS "jobId", t.status,
                    t.skill_name AS "skillName", t.arguments_json AS arguments,
                    t.assigned_worker_id::text AS "assignedWorkerId"
        `,
        [taskId, workerRow.id, workerKey],
      );
      const taskRow = task.rows[0] as Record<string, unknown> | undefined;
      if (!taskRow) {
        throw new RepositoryError(
          "TASK_NOT_RUNNABLE",
          "task is not ready, is already assigned, or has unmet dependencies",
          409,
        );
      }
      await client.query(
        `UPDATE jobs SET status = 'RUNNING' WHERE id = $1 AND status IN ('PENDING', 'READY')`,
        [taskRow.jobId],
      );
      await client.query("COMMIT");
      return taskRow;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async dispatchTask(
    taskId: string,
    workerKey: string,
    commandId: string,
  ): Promise<Command> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const worker = await client.query<{
        id: string;
        online: boolean;
        capabilities_json: unknown;
        transport_type: WorkerTransport;
      }>(
        `
          SELECT id::text, online, capabilities_json, transport_type
          FROM workers
          WHERE worker_key = $1
          FOR UPDATE
        `,
        [workerKey],
      );
      const workerRow = worker.rows[0];
      if (!workerRow) {
        throw new RepositoryError("UNKNOWN_WORKER", "worker was not found", 404);
      }
      if (!workerRow.online) {
        throw new RepositoryError("WORKER_OFFLINE", "worker is not online", 409);
      }

      const active = await client.query(
        `
          SELECT 1
          FROM tasks
          WHERE assigned_worker_id = $1
            AND status IN ('RUNNING', 'PAUSED')
          LIMIT 1
        `,
        [workerRow.id],
      );
      if (active.rowCount) {
        throw new RepositoryError("WORKER_BUSY", "worker already has active task", 409);
      }

      const task = await client.query<{
        id: string;
        job_id: string;
        skill_name: string;
        arguments_json: unknown;
        required_capabilities_json: unknown;
      }>(
        `
          SELECT t.id::text, t.job_id::text, t.skill_name, t.arguments_json,
                 j.required_capabilities_json
          FROM tasks t
          JOIN jobs j ON j.id = t.job_id
          WHERE t.id = $1
            AND t.status = 'READY'
            AND t.assigned_worker_id IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM task_dependencies dependency_link
              JOIN tasks dependency ON dependency.id = dependency_link.depends_on_task_id
              WHERE dependency_link.task_id = t.id
                AND dependency.status <> 'DONE'
            )
          FOR UPDATE OF t
        `,
        [taskId],
      );
      const taskRow = task.rows[0];
      if (!taskRow) {
        throw new RepositoryError(
          "TASK_NOT_RUNNABLE",
          "task is not ready, is already assigned, or has unmet dependencies",
          409,
        );
      }

      const capabilities = new Set(
        capabilityNames(parseJson<unknown>(workerRow.capabilities_json)),
      );
      const required = capabilityNames(parseJson<unknown>(taskRow.required_capabilities_json));
      if (required.some((capability) => !capabilities.has(capability))) {
        throw new RepositoryError(
          "CAPABILITY_NOT_ENABLED",
          "worker does not advertise all task capabilities",
          409,
        );
      }

      const argumentsJson = parseJson<Record<string, unknown>>(taskRow.arguments_json);
      if (
        typeof argumentsJson.targetWorkerId === "string" &&
        argumentsJson.targetWorkerId !== workerKey
      ) {
        throw new RepositoryError(
          "TASK_TARGET_MISMATCH",
          "task is targeted at another worker",
          409,
        );
      }
      const protocolArguments = commandArguments(argumentsJson);
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + 10 * 60_000);
      const command = CommandSchema.parse({
        protocolVersion: 1,
        commandId,
        taskId,
        workerId: workerKey,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        budget: commandBudget(taskRow.skill_name, protocolArguments),
        skill: taskRow.skill_name,
        arguments: protocolArguments,
      });

      await client.query(
        `
          UPDATE tasks
          SET status = 'RUNNING', assigned_worker_id = $2, claimed_at = NOW(),
              started_at = NOW(), attempt_count = attempt_count + 1
          WHERE id = $1
        `,
        [taskId, workerRow.id],
      );
      await client.query(
        `
          INSERT INTO gateway_commands (
            command_id, task_id, worker_key, payload_json, issued_at, expires_at, transport_type
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          command.commandId,
          taskId,
          workerKey,
          asJson(command),
          issuedAt,
          expiresAt,
          workerRow.transport_type,
        ],
      );
      await client.query(
        `UPDATE jobs SET status = 'RUNNING' WHERE id = $1 AND status IN ('PENDING', 'READY')`,
        [taskRow.job_id],
      );
      await client.query("COMMIT");
      return command;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async transitionTask(taskId: string, nextState: string, reason?: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        status: string;
        job_id: string;
        worker_key: string | null;
        transport_type: WorkerTransport | null;
      }>(
        `
          SELECT t.status, t.job_id::text AS job_id,
                 w.worker_key, w.transport_type
          FROM tasks t
          LEFT JOIN workers w ON w.id = t.assigned_worker_id
          WHERE t.id = $1
          FOR UPDATE OF t
        `,
        [taskId],
      );
      const current = result.rows[0];
      if (!current) {
        throw new RepositoryError("UNKNOWN_TASK", "task was not found", 404);
      }
      if (!taskTransitions[current.status]?.includes(nextState)) {
        throw new RepositoryError(
          "INVALID_TASK_TRANSITION",
          `${current.status} cannot transition to ${nextState}`,
          409,
        );
      }

      const requiresStop =
        current.status === "RUNNING" &&
        (nextState === "PAUSED" || nextState === "CANCELLED") &&
        current.worker_key !== null;
      if (requiresStop) {
        await client.query(
          `
            UPDATE gateway_commands
            SET status = 'CANCELLED', completed_at = NOW()
            WHERE task_id = $1
              AND status IN ('QUEUED', 'DELIVERED', 'RUNNING')
          `,
          [taskId],
        );
      }

      await client.query(
        `
          UPDATE tasks
          SET status = $2,
              assigned_worker_id = CASE
                WHEN $2 IN ('DONE', 'FAILED', 'CANCELLED', 'PAUSED') THEN NULL
                ELSE assigned_worker_id
              END,
              last_error_json = CASE
                WHEN $2 IN ('READY', 'RUNNING') THEN NULL
                WHEN $3::text IS NULL THEN last_error_json
                ELSE $3::jsonb
              END
          WHERE id = $1
        `,
        [taskId, nextState, reason ? asJson({ reason }) : null],
      );

      if (nextState === "PAUSED") {
        await client.query(
          `UPDATE jobs SET status = 'PAUSED' WHERE id = $1 AND status IN ('READY', 'RUNNING')`,
          [current.job_id],
        );
      }

      if (current.status === "PAUSED" && nextState === "READY") {
        await client.query(
          `
            UPDATE tasks
            SET status = 'READY', assigned_worker_id = NULL, last_error_json = NULL
            WHERE id = (
              SELECT id
              FROM tasks
              WHERE parent_task_id = $1
                AND workflow_phase IS NOT NULL
                AND status = 'PAUSED'
              ORDER BY id DESC
              LIMIT 1
            )
          `,
          [taskId],
        );
      }
      if (nextState === "READY") {
        await client.query(`UPDATE jobs SET status = 'READY' WHERE id = $1 AND status = 'PAUSED'`, [
          current.job_id,
        ]);
      }

      if (requiresStop) {
        const controlId = `task-stop-${taskId}-${randomUUID()}`.slice(0, 128);
        const control = {
          protocolVersion: 1,
          controlId,
          issuedAt: new Date().toISOString(),
          type: "worker.stop",
          workerId: current.worker_key!,
          reason: reason ?? `task ${nextState.toLowerCase()} by operator`,
        } satisfies StopControl;
        await client.query(
          `
            INSERT INTO gateway_stop_controls (control_id, worker_key, payload_json, transport_type)
            VALUES ($1, $2, $3, $4)
          `,
          [controlId, current.worker_key, asJson(control), current.transport_type],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async listRunnableTasks(): Promise<readonly Record<string, unknown>[]> {
    const result = await this.pool.query(
      `
        SELECT t.id::text AS "taskId", t.job_id::text AS "jobId",
               t.parent_task_id::text AS "parentTaskId", t.workflow_phase AS "workflowPhase",
               t.skill_name AS "skillName", t.arguments_json AS arguments, t.status,
               t.attempt_count AS "attemptCount",
               j.priority, j.required_capabilities_json AS "requiredCapabilities",
               p.goal_text AS "goalText"
        FROM tasks t
        JOIN jobs j ON j.id = t.job_id
        JOIN projects p ON p.id = j.project_id
        WHERE t.status = 'READY'
          AND t.assigned_worker_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM task_dependencies d
            JOIN tasks dependency ON dependency.id = d.depends_on_task_id
            WHERE d.task_id = t.id
              AND dependency.status <> 'DONE'
          )
        ORDER BY t.id
      `,
    );
    return result.rows;
  }
}

export class AuditEventRepository {
  public constructor(private readonly pool: Pool) {}

  public async listRecent(limit: number): Promise<readonly Record<string, unknown>[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new Error("audit event limit must be an integer between 1 and 200");
    }
    const result = await this.pool.query(
      `
        SELECT audit.id::text AS "auditId", audit.occurred_at AS "occurredAt",
               audit.category, audit.principal_id AS "principalId",
               worker.worker_key AS "workerId", audit.skill_name AS "skillName",
               audit.action_json AS action, audit.result_json AS result,
               audit.retention_class AS "retentionClass"
        FROM audit_events audit
        LEFT JOIN workers worker ON worker.id = audit.worker_id
        ORDER BY audit.occurred_at DESC, audit.id DESC
        LIMIT $1
      `,
      [limit],
    );
    return result.rows;
  }

  public async append(input: {
    readonly category: string;
    readonly principalId?: string;
    readonly workerId?: string;
    readonly action: unknown;
    readonly result: unknown;
    readonly retentionClass?: "STANDARD" | "HIGH" | "IMMUTABLE";
  }): Promise<string> {
    const result = await this.pool.query<IdRow>(
      `
        INSERT INTO audit_events (
          category, principal_id, worker_id, action_json, result_json, retention_class
        )
        VALUES ($1, $2, (SELECT id FROM workers WHERE worker_key = $3), $4, $5, $6)
        RETURNING id::text
      `,
      [
        input.category,
        input.principalId ?? null,
        input.workerId ?? null,
        asJson(input.action),
        asJson(input.result),
        input.retentionClass ?? "STANDARD",
      ],
    );
    return result.rows[0]!.id;
  }

  public async cleanupExpired(input: {
    readonly standardRetentionDays: number;
    readonly highRetentionDays: number;
    readonly now?: Date;
  }): Promise<{ readonly standard: number; readonly high: number }> {
    if (
      !Number.isSafeInteger(input.standardRetentionDays) ||
      input.standardRetentionDays <= 0 ||
      !Number.isSafeInteger(input.highRetentionDays) ||
      input.highRetentionDays <= 0
    ) {
      throw new Error("audit retention windows must be positive integers");
    }
    const now = input.now ?? new Date();
    const standardCutoff = new Date(
      now.getTime() - input.standardRetentionDays * 24 * 60 * 60 * 1000,
    );
    const highCutoff = new Date(now.getTime() - input.highRetentionDays * 24 * 60 * 60 * 1000);
    const result = await this.pool.query<{ retention_class: string; count: number }>(
      `
        WITH deleted AS (
          DELETE FROM audit_events
          WHERE (retention_class = 'STANDARD' AND occurred_at < $1)
             OR (retention_class = 'HIGH' AND occurred_at < $2)
          RETURNING retention_class
        )
        SELECT retention_class, COUNT(*)::int AS count
        FROM deleted
        GROUP BY retention_class
      `,
      [standardCutoff, highCutoff],
    );
    return {
      standard: result.rows.find((row) => row.retention_class === "STANDARD")?.count ?? 0,
      high: result.rows.find((row) => row.retention_class === "HIGH")?.count ?? 0,
    };
  }
}
