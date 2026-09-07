import { createDatabasePool, runMigrations } from "./index";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run database migrations");
  }

  const pool = createDatabasePool(connectionString);
  try {
    const result = await runMigrations(pool);
    for (const migration of result.applied) {
      console.log(`Applied migration ${migration.version} (${migration.name})`);
    }
    for (const version of result.skipped) {
      console.log(`Migration ${version} already applied`);
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown migration failure";
  console.error(`Database migration failed: ${message}`);
  process.exitCode = 1;
});
