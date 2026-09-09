import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  createDatabasePool,
  blockedMovementForReplan,
  effectivePositionConfidence,
  gatherResultMeetsTarget,
  inventorySlotsFromCommandEvent,
  peripheralSnapshotFromCommandEvent,
  inventoryFullRecoveryPlan,
  inventoryFullRecoveryRemainingQuantity,
  isInventoryFullFailure,
  migrationChecksum,
  migrationChecksumVariants,
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
    ["001", "002", "003", "004", "005", "006", "007", "008", "009", "010", "011", "012"],
  );
  const migrationsReadAgain = readMigrationFiles(migrationDirectory);
  assert.equal(migrationChecksum(migrations[0]!), migrationChecksum(migrationsReadAgain[0]!));
  assert.equal(migrationChecksumVariants(migrations[0]!).length, 2);

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
  const plannerRuntimeSql = readFileSync(
    join(migrationDirectory, "010_planner_runtime_state.sql"),
    "utf8",
  );
  assert.match(plannerRuntimeSql, /CREATE TABLE planner_runtime_state/);
  assert.match(plannerRuntimeSql, /ON CONFLICT \(runtime_id\) DO NOTHING/);
  const locationApproachSql = readFileSync(
    join(migrationDirectory, "011_named_location_approach.sql"),
    "utf8",
  );
  assert.match(locationApproachSql, /approach_json JSONB/);
  const peripheralObservationSql = readFileSync(
    join(migrationDirectory, "012_peripheral_observations.sql"),
    "utf8",
  );
  assert.match(peripheralObservationSql, /peripherals_json JSONB/);
  const repositorySql = readFileSync(
    join(__dirname, "../packages/database/src/repositories.ts"),
    "utf8",
  );
  assert.match(repositorySql, /FOR UPDATE SKIP LOCKED/);
  assert.match(repositorySql, /status = 'PROCESSING'/);
  assert.match(repositorySql, /requeueStalePlannerTriggers/);
  assert.match(repositorySql, /releasePlannerTrigger/);
  assert.match(repositorySql, /active_task\.task_id AS "currentTaskId"/);
  assert.match(repositorySql, /w\.minecraft_server_id AS "minecraftServerId"/);
  assert.match(repositorySql, /w\.runtime_version AS "runtimeVersion"/);
  assert.match(repositorySql, /observation\.inventory_json AS "inventory"/);
  assert.match(repositorySql, /observation\.peripherals_json AS "peripherals"/);
  assert.match(repositorySql, /inventory_json, peripherals_json, current_command_id/);
  assert.match(repositorySql, /t\.status IN \('RUNNING', 'PAUSED'\)/);
  assert.match(repositorySql, /j\.status IN \('PENDING', 'READY', 'RUNNING'\)/);
  assert.match(repositorySql, /p\.status IN \('PLANNING', 'ACTIVE'\)/);
  assert.match(repositorySql, /FROM jobs j\s+JOIN projects p ON p\.id = j\.project_id/s);
  assert.match(repositorySql, /getPlannerRuntimeState/);
  assert.match(repositorySql, /savePlannerRuntimeState/);
  assert.match(repositorySql, /applyPlannerTaskProposals/);
  assert.match(repositorySql, /CommandSchema\.safeParse/);
  assert.match(repositorySql, /_plannerTriggerId/);
  assert.match(repositorySql, /PLANNER_SCOPE_VIOLATION/);
  assert.match(repositorySql, /event_type = 'inventory\.changed'/);
  assert.match(repositorySql, /inventorySlotsFromCommandEvent/);
  assert.match(repositorySql, /recordInventorySnapshot/);
  assert.match(repositorySql, /peripheralSnapshotFromCommandEvent/);
  assert.match(repositorySql, /recordPeripheralSnapshot/);
  assert.match(repositorySql, /lastEventPayload/);
  assert.match(repositorySql, /JOIN gateway_commands c ON c.command_id = e.command_id/);
  assert.match(repositorySql, /gatherResultMeetsTarget\(eventPayload\.result, itemKey, quantity\)/);
  assert.match(repositorySql, /SELECT transport_type FROM workers WHERE worker_key = \$1/);
  assert.match(repositorySql, /worker is not registered/);
  assert.match(repositorySql, /VALUES \(\$1, \$2, \$3, \$4\)/);
});

test("migration checksum variants accept newline-only deployment differences", () => {
  const migration = {
    version: "001",
    name: "initial_schema",
    filename: "001_initial_schema.sql",
    sql: "CREATE TABLE example (id INTEGER);\nCREATE INDEX example_id_idx ON example(id);\n",
  };
  const crlfMigration = { ...migration, sql: migration.sql.replace(/\n/g, "\r\n") };
  assert.deepEqual(
    new Set(migrationChecksumVariants(migration)),
    new Set(migrationChecksumVariants(crlfMigration)),
  );
  assert.equal(migrationChecksum(migration), migrationChecksumVariants(migration)[0]);
  assert.notEqual(migrationChecksum(migration), migrationChecksum(crlfMigration));
});

test("position persistence seeds only the observed world cell as walkable", () => {
  const repositorySql = readFileSync(
    join(__dirname, "../packages/database/src/repositories.ts"),
    "utf8",
  );
  assert.match(repositorySql, /private async recordWalkablePosition/);
  assert.match(
    repositorySql,
    /source_worker_id\s*\)\s*VALUES \(\$1, \$2, \$3, \$4, NULL, NULL, TRUE/,
  );
  assert.match(repositorySql, /if \(worker\.position\) \{\s*await this\.recordWalkablePosition/s);
  assert.match(repositorySql, /if \(payload\.position\) \{\s*await this\.recordWalkablePosition/s);
  assert.match(
    repositorySql,
    /public async upsertNamedLocation[\s\S]+source_worker_id\s*\)\s*VALUES \(\$1, \$2, \$3, \$4, NULL, NULL, TRUE, NOW\(\), NULL/s,
  );
  assert.match(repositorySql, /const approach = coordinateFromUnknown\(input\.approach\)/);
  assert.match(repositorySql, /approach\.dimension, approach\.x, approach\.y, approach\.z/);
  assert.match(repositorySql, /event\.type === "movement\.blocked"/);
  assert.match(
    repositorySql,
    /walkable, observed_at, source_worker_id\s*\)\s*VALUES \(\$1, \$2, \$3, \$4, NULL, NULL, FALSE/s,
  );
  assert.match(repositorySql, /payload\.block === null \|\| payload\.block === undefined/);
  assert.match(repositorySql, /replanGatherNavigation/);
  assert.match(repositorySql, /navigationReplanCount/);
  assert.match(repositorySql, /position_confidence = 'CONFIRMED_ANCHOR'/);
});

test("position confidence preserves an anchor only at the same coordinate", () => {
  const anchor = {
    dimension: 0,
    x: 10,
    y: 64,
    z: -2,
    confidence: "CONFIRMED_ANCHOR",
  };
  assert.equal(
    effectivePositionConfidence(
      { dimension: 0, x: 10, y: 64, z: -2, confidence: "UNKNOWN" },
      anchor,
    ),
    "CONFIRMED_ANCHOR",
  );
  assert.equal(
    effectivePositionConfidence(
      { dimension: 0, x: 11, y: 64, z: -2, confidence: "UNKNOWN" },
      anchor,
    ),
    "UNKNOWN",
  );
  assert.equal(
    effectivePositionConfidence(
      { dimension: 0, x: 10, y: 64, z: -2, confidence: "DEAD_RECKONED" },
      undefined,
    ),
    "DEAD_RECKONED",
  );
});

test("blocked movement failures expose a bounded replan input", () => {
  const result = blockedMovementForReplan({
    protocolVersion: 1,
    eventId: "event-blocked",
    workerId: "alice",
    commandId: "command-blocked",
    sequence: 1,
    type: "command.failed",
    occurredAt: "2026-09-09T00:00:00.000Z",
    payload: {
      error: {
        code: "INTERNAL_ERROR",
        message: "movement blocked",
        retryable: true,
        details: {
          result: {
            status: "BLOCKED",
            direction: "E",
            position: { dimension: 0, x: 1, y: 64, z: 2 },
          },
        },
      },
    },
  });
  assert.deepEqual(result, {
    direction: "E",
    position: { dimension: 0, x: 1, y: 64, z: 2 },
  });
});

test("urgent command cancellation pauses the logical task", () => {
  assert.equal(taskStatusForCommandEvent("command.completed"), "DONE");
  assert.equal(taskStatusForCommandEvent("command.failed"), "FAILED");
  assert.equal(taskStatusForCommandEvent("command.cancelled"), "PAUSED");
  assert.equal(taskStatusForCommandEvent("worker.state"), undefined);
});

test("workflow deposit requires the complete transfer quantity", () => {
  assert.equal(transferMeetsQuantity({ moved: 8 }, 8), true);
  assert.equal(
    transferMeetsQuantity(
      { itemKey: "minecraft:cobblestone", moved: 8 },
      8,
      "minecraft:cobblestone",
    ),
    true,
  );
  assert.equal(
    transferMeetsQuantity({ itemKey: "minecraft:dirt", moved: 8 }, 8, "minecraft:cobblestone"),
    false,
  );
  assert.equal(transferMeetsQuantity({ moved: 7 }, 8), false);
  assert.equal(transferMeetsQuantity({ status: "OK" }, 8), false);
});

test("gather workflow requires matching item and quantity evidence", () => {
  assert.equal(
    gatherResultMeetsTarget(
      { status: "OK", itemKey: "minecraft:cobblestone", collected: 8 },
      "minecraft:cobblestone",
      8,
    ),
    true,
  );
  assert.equal(
    gatherResultMeetsTarget(
      { status: "OK", itemKey: "minecraft:dirt", collected: 8 },
      "minecraft:cobblestone",
      8,
    ),
    false,
  );
  assert.equal(
    gatherResultMeetsTarget(
      { status: "OK", itemKey: "minecraft:cobblestone", collected: 7 },
      "minecraft:cobblestone",
      8,
    ),
    false,
  );
  assert.equal(
    gatherResultMeetsTarget(
      { status: "TARGET_NOT_REACHED", itemKey: "minecraft:cobblestone", collected: 8 },
      "minecraft:cobblestone",
      8,
    ),
    false,
  );
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
  assert.match(repositories, /queueGatherDelivery/);
  assert.match(repositories, /resumeGatherAfterDeposit/);
});

test("inventory inspection results provide a persisted inventory snapshot", () => {
  assert.deepEqual(
    inventorySlotsFromCommandEvent({
      protocolVersion: 1,
      eventId: "inspect-event",
      workerId: "alice",
      commandId: "inspect-command",
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: "command.completed",
      payload: {
        result: {
          status: "OK",
          inventory: {
            slots: [{ slot: 1, itemKey: "minecraft:cobblestone", count: 3 }],
            freeSlots: 15,
            selectedSlot: 1,
          },
        },
      },
    } as Event),
    [{ slot: 1, itemKey: "minecraft:cobblestone", count: 3 }],
  );
  assert.equal(
    inventorySlotsFromCommandEvent({
      protocolVersion: 1,
      eventId: "movement-event",
      workerId: "alice",
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: "worker.state",
      payload: {
        state: "IDLE",
        position: null,
        fuel: null,
        currentCommandId: null,
      },
    } as Event),
    undefined,
  );
});

test("peripheral inspection results provide a persisted peripheral snapshot", () => {
  assert.deepEqual(
    peripheralSnapshotFromCommandEvent({
      protocolVersion: 1,
      eventId: "peripheral-event",
      workerId: "alice",
      commandId: "peripheral-command",
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: "command.completed",
      payload: {
        result: {
          status: "OK",
          peripherals: [{ side: "top", type: "minecraft:chest", methods: ["list", "size"] }],
        },
      },
    } as Event),
    [{ side: "top", type: "minecraft:chest", methods: ["list", "size"] }],
  );
  assert.deepEqual(
    peripheralSnapshotFromCommandEvent({
      protocolVersion: 1,
      eventId: "empty-peripheral-event",
      workerId: "alice",
      commandId: "empty-peripheral-command",
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: "command.completed",
      payload: { result: { status: "OK", peripherals: [] } },
    } as Event),
    [],
  );
});

test("inventory-full gather failures produce a bounded return-and-resume plan", () => {
  const event = {
    protocolVersion: 1,
    eventId: "event-full",
    workerId: "alice",
    commandId: "command-full",
    sequence: 1,
    occurredAt: new Date().toISOString(),
    type: "command.failed",
    payload: {
      error: {
        code: "INTERNAL_ERROR",
        message: "worker inventory is full",
        retryable: true,
        details: {
          result: { status: "INVENTORY_FULL", collected: 23 },
        },
      },
    },
  } as Event;
  assert.deepEqual(
    inventoryFullRecoveryPlan(event, {
      targetWorkerId: "alice",
      itemKey: "minecraft:cobblestone",
      quantity: 64,
      destination: "Test Chest",
    }),
    {
      targetWorkerId: "alice",
      itemKey: "minecraft:cobblestone",
      quantity: 64,
      destination: "Test Chest",
      depositQuantity: 23,
    },
  );
  assert.equal(
    inventoryFullRecoveryPlan(event, {
      targetWorkerId: "alice",
      itemKey: "minecraft:cobblestone",
      quantity: 64,
      destination: "Test Chest",
    })?.depositQuantity,
    23,
  );
  assert.deepEqual(
    inventoryFullRecoveryPlan(event, {
      targetWorkerId: "alice",
      itemKey: "minecraft:cobblestone",
      quantity: 64,
      remainingQuantity: 41,
      destination: "Test Chest",
    }),
    {
      targetWorkerId: "alice",
      itemKey: "minecraft:cobblestone",
      quantity: 41,
      destination: "Test Chest",
      depositQuantity: 23,
    },
  );
  assert.equal(
    inventoryFullRecoveryRemainingQuantity(event, {
      targetWorkerId: "alice",
      itemKey: "minecraft:cobblestone",
      quantity: 64,
      destination: "Test Chest",
    }),
    41,
  );
  assert.equal(
    inventoryFullRecoveryRemainingQuantity(event, {
      targetWorkerId: "alice",
      itemKey: "minecraft:cobblestone",
      quantity: 41,
      remainingQuantity: 41,
      destination: "Test Chest",
    }),
    18,
  );
});

test("manual inventory recovery preserves the remaining gather quantity", () => {
  const repositories = readFileSync(
    join(__dirname, "../packages/database/src/repositories.ts"),
    "utf8",
  );
  assert.match(repositories, /manualInventoryRecovery/);
  assert.match(repositories, /remainingQuantity/);
  assert.match(repositories, /jsonb_set\(arguments_json, '\{quantity\}'/);
  assert.match(repositories, /parentArguments\.manualInventoryRecovery === true/);
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
  assert.match(repositories, /activeExecution\.transport_type/);
});

test("operator pause and cancel propagate to the active workflow child", () => {
  const repositories = readFileSync(
    join(__dirname, "../packages/database/src/repositories.ts"),
    "utf8",
  );
  assert.match(repositories, /t\.parent_task_id = \$1/);
  assert.match(repositories, /propagatesToWorkflowChildren/);
  assert.match(repositories, /SELECT id FROM tasks WHERE id = \$1 OR parent_task_id = \$1/);
  assert.match(repositories, /WHERE parent_task_id = \$1[\s\S]*status IN \('READY', 'RUNNING'\)/);
  assert.match(repositories, /activeExecution\.worker_key/);
  assert.match(repositories, /activeExecution\.transport_type/);
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
