import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  createDatabasePool,
  migrationChecksum,
  readMigrationFiles,
  runMigrations,
} from "../packages/database/src/index";

const migrationDirectory = join(__dirname, "../packages/database/migrations");

test("database migration set is ordered and contains the core relational model", () => {
  const migrations = readMigrationFiles(migrationDirectory);
  assert.deepEqual(
    migrations.map((migration) => migration.version),
    ["001", "002", "003"],
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
