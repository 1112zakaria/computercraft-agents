import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Pool } from "pg";
import type { PoolClient } from "pg";

export interface Migration {
  readonly version: string;
  readonly name: string;
  readonly filename: string;
  readonly sql: string;
}

export interface AppliedMigration {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
  readonly appliedAt: Date;
}

export interface MigrationRunResult {
  readonly applied: readonly AppliedMigration[];
  readonly skipped: readonly string[];
}

const migrationFilenamePattern = /^(\d+)_([a-z0-9_-]+)\.sql$/i;
const migrationLockKey = "computercraft-agents:migrations";

function defaultMigrationsDirectory(): string {
  const candidates = [join(__dirname, "migrations"), join(__dirname, "..", "migrations")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

export function readMigrationFiles(directory = defaultMigrationsDirectory()): Migration[] {
  const migrations = readdirSync(directory)
    .map((filename) => {
      const match = migrationFilenamePattern.exec(filename);
      if (!match) {
        return undefined;
      }

      const [, version, name] = match;
      return {
        version: version!,
        name: name!,
        filename,
        sql: readFileSync(resolve(directory, filename), "utf8"),
      } satisfies Migration;
    })
    .filter((migration): migration is Migration => migration !== undefined)
    .sort((left, right) => Number(left.version) - Number(right.version));

  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index - 1]?.version === migrations[index]?.version) {
      throw new Error(`Duplicate migration version: ${migrations[index]?.version}`);
    }
  }

  return migrations;
}

export function migrationChecksum(migration: Migration): string {
  return createHash("sha256").update(migration.sql).digest("hex");
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function readAppliedMigrations(client: PoolClient): Promise<Map<string, AppliedMigration>> {
  const result = await client.query<{
    version: string;
    name: string;
    checksum: string;
    applied_at: Date;
  }>(
    `
      SELECT version, name, checksum, applied_at
      FROM schema_migrations
      ORDER BY version
    `,
  );

  return new Map(
    result.rows.map((row) => [
      row.version,
      {
        version: row.version,
        name: row.name,
        checksum: row.checksum,
        appliedAt: row.applied_at,
      },
    ]),
  );
}

async function applyMigration(client: PoolClient, migration: Migration): Promise<AppliedMigration> {
  const checksum = migrationChecksum(migration);
  await client.query("BEGIN");

  try {
    await client.query(migration.sql);
    const result = await client.query<{
      version: string;
      name: string;
      checksum: string;
      applied_at: Date;
    }>(
      `
        INSERT INTO schema_migrations (version, name, checksum)
        VALUES ($1, $2, $3)
        RETURNING version, name, checksum, applied_at
      `,
      [migration.version, migration.name, checksum],
    );
    await client.query("COMMIT");

    const row = result.rows[0];
    if (!row) {
      throw new Error(`Migration ${migration.filename} did not return an applied row`);
    }

    return {
      version: row.version,
      name: row.name,
      checksum: row.checksum,
      appliedAt: row.applied_at,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function runMigrations(
  pool: Pool,
  directory = defaultMigrationsDirectory(),
): Promise<MigrationRunResult> {
  const migrations = readMigrationFiles(directory);
  const client = await pool.connect();
  const applied: AppliedMigration[] = [];
  const skipped: string[] = [];

  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [migrationLockKey]);
    await ensureMigrationTable(client);
    const appliedMigrations = await readAppliedMigrations(client);

    for (const migration of migrations) {
      const existing = appliedMigrations.get(migration.version);
      if (existing) {
        const checksum = migrationChecksum(migration);
        if (existing.checksum !== checksum) {
          throw new Error(
            `Migration ${migration.filename} changed after application; expected ${existing.checksum}, got ${checksum}`,
          );
        }
        skipped.push(migration.version);
        continue;
      }

      applied.push(await applyMigration(client, migration));
    }

    return { applied, skipped };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [migrationLockKey]);
    client.release();
  }
}

export function createDatabasePool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

export * from "./repositories";
