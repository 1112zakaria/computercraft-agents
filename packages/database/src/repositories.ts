import type {
  Command,
  Event,
  EventBatch,
  GatewayHeartbeat,
  GatewayRegistration,
  StopControl,
} from "@computercraft-agents/protocol";
import type { Pool, PoolClient, QueryResultRow } from "pg";

export interface GatewayRuntimeConfig {
  readonly gatewayTimeoutSeconds: number;
  readonly workerTimeoutSeconds: number;
}

export interface GatewayPollResult {
  readonly commands: readonly Command[];
  readonly stopControls: readonly StopControl[];
  readonly nextCursor: string | null;
}

export interface GatewayIdentity {
  readonly gatewayId: string;
  readonly bootId: string;
}

interface GatewayRow extends QueryResultRow {
  id: string;
  gateway_key: string;
  boot_id: string;
}

interface WorkerRow extends QueryResultRow {
  id: string;
  worker_key: string;
  gateway_id: string;
  computer_id: number;
}

interface CursorRow extends QueryResultRow {
  id: string;
  delivery_cursor: string;
  payload_json: Command | StopControl;
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

export class GatewayRuntimeRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly config: GatewayRuntimeConfig,
  ) {}

  public async register(
    payload: Omit<GatewayRegistration, "capabilities"> & { readonly capabilities?: unknown },
  ): Promise<GatewayIdentity> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const gateway = await this.upsertGateway(client, payload.gatewayId, payload.bootId, {
        minecraftServerId: payload.minecraftServerId,
        runtimeVersion: payload.runtimeVersion ?? null,
        capabilities: payload.capabilities ?? [],
        status: "ONLINE",
      });

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
            worker.position?.confidence ?? null,
            worker.fuel?.level ?? null,
            worker.currentCommandId ?? null,
            worker.status,
          ],
        );
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
    const [commands, stopControls] = await Promise.all([
      this.pool.query<CursorRow>(
        `
          SELECT id, delivery_cursor, payload_json
          FROM gateway_commands
          WHERE delivery_cursor > $1
            AND status IN ('QUEUED', 'DELIVERED', 'RUNNING')
            AND expires_at > NOW()
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
              payload_json->>'type' = 'all.stop'
              OR worker_key IN (SELECT worker_key FROM workers WHERE gateway_id = $2)
            )
          ORDER BY delivery_cursor
          LIMIT 128
        `,
        [afterId, gateway.id],
      ),
    ]);

    const commandRows = commands.rows;
    const stopRows = stopControls.rows;
    const maxId = [...commandRows, ...stopRows]
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
      nextCursor: maxId === BigInt(afterId) ? null : maxId.toString(),
    };
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

  public async enqueueCommand(command: Command): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO gateway_commands (command_id, worker_key, payload_json, issued_at, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (command_id) DO NOTHING
      `,
      [
        command.commandId,
        command.workerId,
        asJson(command),
        new Date(command.issuedAt),
        new Date(command.expiresAt),
      ],
    );
  }

  public async enqueueStopControl(control: StopControl): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO gateway_stop_controls (control_id, worker_key, payload_json)
        VALUES ($1, $2, $3)
        ON CONFLICT (control_id) DO NOTHING
      `,
      [
        control.controlId,
        control.type === "worker.stop" ? control.workerId : null,
        asJson(control),
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
    await this.pool.query(
      `UPDATE gateways SET status = 'OFFLINE' WHERE last_seen_at IS NULL OR last_seen_at < $1`,
      [gatewayCutoff],
    );
    await this.pool.query(
      `UPDATE workers SET online = FALSE WHERE last_seen_at IS NULL OR last_seen_at < $1 OR gateway_id IN (SELECT id FROM gateways WHERE status = 'OFFLINE')`,
      [workerCutoff],
    );
  }

  public async listWorkers(): Promise<readonly Record<string, unknown>[]> {
    const result = await this.pool.query(
      `
        SELECT worker_key AS "workerId", computer_id AS "computerId", online,
               boot_id AS "bootId", runtime_version AS "runtimeVersion",
               last_seen_at AS "lastSeenAt", capabilities_json AS capabilities
        FROM workers
        ORDER BY worker_key
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
      `SELECT id, worker_key, gateway_id, computer_id FROM workers WHERE worker_key = $1`,
      [values.workerKey],
    );
    if (existing.rows[0] && existing.rows[0].gateway_id !== gatewayId) {
      throw new RepositoryError(
        "WORKER_BOUND_ELSEWHERE",
        "worker is already bound to another gateway",
        409,
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

  private async applyEvent(client: PoolClient, gatewayId: string, event: Event): Promise<void> {
    if (event.workerId) {
      const worker = await client.query<WorkerRow>(
        `SELECT id, worker_key, gateway_id, computer_id FROM workers WHERE worker_key = $1`,
        [event.workerId],
      );
      const workerRow = worker.rows[0];
      if (!workerRow || workerRow.gateway_id !== gatewayId) {
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
        `SELECT id, worker_key, gateway_id, computer_id FROM workers WHERE worker_key = $1`,
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
          payload.position?.confidence ?? null,
          payload.fuel?.level ?? null,
          payload.currentCommandId,
          payload.state === "IDLE" ? "ONLINE" : "ONLINE",
        ],
      );
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
    }
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

  public async transitionTask(taskId: string, nextState: string): Promise<void> {
    const result = await this.pool.query<{ status: string }>(
      `SELECT status FROM tasks WHERE id = $1`,
      [taskId],
    );
    const current = result.rows[0]?.status;
    if (!current) {
      throw new RepositoryError("UNKNOWN_TASK", "task was not found", 404);
    }
    if (!taskTransitions[current]?.includes(nextState)) {
      throw new RepositoryError(
        "INVALID_TASK_TRANSITION",
        `${current} cannot transition to ${nextState}`,
        409,
      );
    }
    await this.pool.query(`UPDATE tasks SET status = $2 WHERE id = $1`, [taskId, nextState]);
  }

  public async listRunnableTasks(): Promise<readonly Record<string, unknown>[]> {
    const result = await this.pool.query(
      `
        SELECT t.id::text AS "taskId", t.job_id::text AS "jobId", t.skill_name AS "skillName",
               t.arguments_json AS arguments, t.status
        FROM tasks t
        WHERE t.status = 'READY'
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
}
