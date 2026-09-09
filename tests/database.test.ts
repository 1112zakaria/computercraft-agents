import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  createDatabasePool,
  isInventoryFullFailure,
  migrationChecksum,
  readMigrationFiles,
  runMigrations,
  taskStatusForCommandEvent,
  transferMeetsQuantity,
  workflowStepEventCanAdvance,
} from "../packages/database/src/index";
import type { Event } from "../packages/protocol/src/index";

const migrationDirectory = join(__dirname, "../packages/database/migrations");

test("database migration set is ordered and contains the core relational model", () => {
  const migrations = readMigrationFiles(migrationDirectory);
  assert.deepEqual(
    migrations.map((migration) => migration.version),
    ["001", "002", "003", "004", "005", "006", "007", "008", "009"],
  );
  const migrationsReadAgain = readMigrationFiles(migrationDirectory);
  assert.equal(migrationChecksum(migrations[0]!), migrationChecksum(migrationsReadAgain[0]!));

  const sql = readFileSync(join(migrationDirectory, "001_initial_schema.sql"), "utf8");
  for (const table of [
    "gateways",
    "workers",
    "worker_observations",
    "agents",
    "groups",
    "group_members",
    "projects",
    "jobs",
    "tasks",
    "task_dependencies",
    "standing_policies",
    "named_locations",
    "resource_reservations",
    "conversations",
    "messages",
    "memories",
    "audit_events",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table} \\(`));
  }

  assert.match(sql, /REFERENCES workers\(id\)/);
  assert.match(sql, /CHECK \(task_id <> depends_on_task_id\)/);
  assert.match(sql, /CREATE INDEX audit_events_lineage_idx/);
  assert.match(sql, /CREATE TRIGGER jobs_set_updated_at/);

  const runtimeSql = readFileSync(join(migrationDirectory, "002_gateway_runtime.sql"), "utf8");
  for (const table of ["gateway_commands", "gateway_stop_controls", "gateway_events"]) {
    assert.match(runtimeSql, new RegExp(`CREATE TABLE ${table} \\(`));
  }
  assert.match(runtimeSql, /gateway_delivery_cursor_seq/);

  const updateSql = readFileSync(join(migrationDirectory, "003_update_rollouts.sql"), "utf8");
  for (const table of ["update_rollouts", "update_events"]) {
    assert.match(updateSql, new RegExp(`CREATE TABLE ${table} \\(`));
  }
  assert.match(updateSql, /update_rollouts_active_gateway_idx/);

  const directSql = readFileSync(
    join(migrationDirectory, "004_direct_worker_transport.sql"),
    "utf8",
  );
  assert.match(directSql, /transport_type/);
  assert.match(directSql, /workers_transport_gateway_consistency/);
  assert.match(directSql, /update_rollouts_active_direct_worker_idx/);

  const taskSql = readFileSync(join(migrationDirectory, "005_task_claims.sql"), "utf8");
  assert.match(taskSql, /assigned_worker_id/);
  assert.match(taskSql, /tasks_active_worker_idx/);

  const worldSql = readFileSync(join(migrationDirectory, "006_world_cells.sql"), "utf8");
  assert.match(worldSql, /CREATE TABLE world_cells/);
  assert.match(worldSql, /PRIMARY KEY \(dimension, x, y, z\)/);

  const dispatchSql = readFileSync(join(migrationDirectory, "007_task_dispatch.sql"), "utf8");
  assert.match(dispatchSql, /ADD COLUMN task_id BIGINT REFERENCES tasks\(id\)/);
  assert.match(dispatchSql, /gateway_commands_active_task_idx/);

  const workflowSql = readFileSync(join(migrationDirectory, "008_task_workflows.sql"), "utf8");
  assert.match(workflowSql, /ADD COLUMN parent_task_id BIGINT REFERENCES tasks\(id\)/);
  assert.match(workflowSql, /tasks_parent_workflow_idx/);

  const plannerSql = readFileSync(join(migrationDirectory, "009_planner_triggers.sql"), "utf8");
  assert.match(plannerSql, /CREATE TABLE planner_triggers/);
  assert.match(plannerSql, /planner_triggers_pending_idx/);
  const repositorySql = readFileSync(
    join(__dirname, "../packages/database/src/repositories.ts"),
    "utf8",
  );
  assert.match(repositorySql, /FOR UPDATE SKIP LOCKED/);
  assert.match(repositorySql, /status = 'PROCESSING'/);
});

test("urgent command cancellation pauses the logical task", () => {
  assert.equal(taskStatusForCommandEvent("command.completed"), "DONE");
  assert.equal(taskStatusForCommandEvent("command.failed"), "FAILED");
  assert.equal(taskStatusForCommandEvent("command.cancelled"), "PAUSED");
  assert.equal(taskStatusForCommandEvent("worker.state"), undefined);
});

test("workflow deposit requires the complete transfer quantity", () => {
  assert.equal(transferMeetsQuantity({ moved: 8 }, 8), true);
  assert.equal(transferMeetsQuantity({ moved: 7 }, 8), false);
  assert.equal(transferMeetsQuantity({ status: "OK" }, 8), false);
});

test("workflow advancement ignores late or duplicate step events", () => {
  assert.equal(workflowStepEventCanAdvance("DONE", "command.completed"), true);
  assert.equal(workflowStepEventCanAdvance("FAILED", "command.failed"), true);
  assert.equal(workflowStepEventCanAdvance("PAUSED", "command.completed"), false);
  assert.equal(workflowStepEventCanAdvance("RUNNING", "command.completed"), false);
  assert.equal(workflowStepEventCanAdvance("DONE", "command.failed"), false);
});

test("inventory-full failures are identified as resumable workflow pauses", () => {
  const event = {
    protocolVersion: 1,
    eventId: "event-1",
    workerId: "alice",
    commandId: "command-1",
    sequence: 1,
    occurredAt: new Date().toISOString(),
    type: "command.failed",
    payload: {
      error: {
        code: "INVALID_ARGUMENTS",
        message: "worker inventory is full",
        retryable: true,
        details: { status: "INVENTORY_FULL" },
      },
    },
  } as Event;
  assert.equal(isInventoryFullFailure(event), true);

  const repositories = readFileSync(
    join(__dirname, "../packages/database/src/repositories.ts"),
    "utf8",
  );
  assert.match(repositories, /explicitly resume the gather task/);
  assert.match(
    repositories,
    /UPDATE jobs SET status = 'READY' WHERE id = \$1 AND status = 'PAUSED'/,
  );
});

test("stale recovery keeps command delivery behind an explicit resume boundary", () => {
  const repositories = readFileSync(
    join(__dirname, "../packages/database/src/repositories.ts"),
    "utf8",
  );
  assert.match(repositories, /status = 'PAUSED'/);
  assert.match(repositories, /worker became stale; explicit resume required/);
  assert.match(repositories, /status = 'CANCELLED'/);
  assert.match(repositories, /worker became stale; stop before explicit resume/);
  assert.match(repositories, /worker\.recovery\.stale/);
  assert.match(repositories, /retention_class/);
});

test("operator pause and cancel preserve a transport-aware stop boundary", () => {
  const repositories = readFileSync(
    join(__dirname, "../packages/database/src/repositories.ts"),
    "utf8",
  );
  assert.match(repositories, /current\.status === "RUNNING"/);
  assert.match(repositories, /status IN \('QUEUED', 'DELIVERED', 'RUNNING'\)/);
  assert.match(repositories, /WHEN \$2 IN \('DONE', 'FAILED', 'CANCELLED', 'PAUSED'\)/);
  assert.match(repositories, /INSERT INTO gateway_stop_controls/);
  assert.match(repositories, /current\.transport_type/);
});

test("audit retention cleanup preserves immutable history", () => {
  const repositories = readFileSync(
    join(__dirname, "../packages/database/src/repositories.ts"),
    "utf8",
  );
  assert.match(repositories, /cleanupExpired/);
  assert.match(repositories, /DELETE FROM audit_events/);
  assert.match(repositories, /retention_class = 'STANDARD'/);
  assert.match(repositories, /retention_class = 'HIGH'/);
  assert.doesNotMatch(repositories, /retention_class = 'IMMUTABLE'.*DELETE/s);
});

test("gateway restart recovery cancels uncertain work behind an explicit resume boundary", () => {
  const repositories = readFileSync(
    join(__dirname, "../packages/database/src/repositories.ts"),
    "utf8",
  );
  assert.match(repositories, /reconcileGatewayRestart/);
  assert.match(repositories, /gateway restarted; explicit resume required/);
  assert.match(repositories, /gateway restarted; stop before explicit resume/);
  assert.match(repositories, /gateway\.recovery\.restart/);
  assert.match(repositories, /status IN \('QUEUED', 'DELIVERED', 'RUNNING'\)/);
});

test("control-plane restart recovery invalidates online work before reconnect", () => {
  const repositories = readFileSync(
    join(__dirname, "../packages/database/src/repositories.ts"),
    "utf8",
  );
  assert.match(repositories, /reconcileControlPlaneRestart/);
  assert.match(repositories, /control plane restarted; explicit resume required/);
  assert.match(repositories, /control plane restarted; stop before explicit resume/);
  assert.match(repositories, /control_plane\.recovery\.restart/);
  assert.match(repositories, /UPDATE gateways SET status = 'OFFLINE'/);
});

test("recovery and explicit task transitions keep job status aligned", () => {
  const repositories = readFileSync(
    join(__dirname, "../packages/database/src/repositories.ts"),
    "utf8",
  );
  assert.match(repositories, /UPDATE jobs\s+SET status = 'PAUSED'/);
  assert.match(repositories, /WITH paused AS \(\s+UPDATE tasks/s);
  assert.match(repositories, /RETURNING job_id/);
  assert.match(
    repositories,
    /UPDATE jobs SET status = 'READY' WHERE id = \$1 AND status = 'PAUSED'/,
  );
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl) {
  test("database migrations apply and are idempotent in the configured test database", async () => {
    const pool = createDatabasePool(testDatabaseUrl);
    try {
      const firstRun = await runMigrations(pool, migrationDirectory);
      const secondRun = await runMigrations(pool, migrationDirectory);
      const tables = await pool.query<{ table_name: string }>(
        `
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('agents', 'workers', 'projects', 'tasks', 'audit_events')
          ORDER BY table_name
        `,
      );

      assert.equal(firstRun.applied.length <= 1, true);
      assert.equal(secondRun.applied.length, 0);
      assert.deepEqual(
        tables.rows.map((row) => row.table_name),
        ["agents", "audit_events", "projects", "tasks", "workers"],
      );
    } finally {
      await pool.end();
    }
  });
}
