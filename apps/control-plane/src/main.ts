import {
  createDatabasePool,
  GatewayRuntimeRepository,
  runMigrations,
} from "@computercraft-agents/database";

import { loadConfig } from "./config";
import { createRepositoryService } from "./gateway-service";
import { createControlPlaneServer } from "./http";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createDatabasePool(config.databaseUrl);
  await runMigrations(pool);

  const repository = new GatewayRuntimeRepository(pool, {
    gatewayTimeoutSeconds: config.gatewayTimeoutSeconds,
    workerTimeoutSeconds: config.workerTimeoutSeconds,
  });
  const service = createRepositoryService(
    repository,
    config.gatewayBearerSecret,
    config.adminSecret,
    config.enabledSkills,
  );
  const server = createControlPlaneServer({ service, maxBodyBytes: config.maxHttpBodyBytes });

  let schedulerInFlight = false;
  const schedulerTimer = config.schedulerEnabled
    ? setInterval(() => {
        if (schedulerInFlight) return;
        schedulerInFlight = true;
        void service
          .dispatchRunnableTasks()
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "unknown scheduler failure";
            console.error(`Scheduler tick failed: ${message}`);
          })
          .finally(() => {
            schedulerInFlight = false;
          });
      }, config.schedulerIntervalSeconds * 1000)
    : undefined;

  const staleWorkerTimer = setInterval(() => {
    void repository.markStale().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown stale-worker failure";
      console.error(`Stale-worker check failed: ${message}`);
    });
  }, config.staleCheckIntervalSeconds * 1000);

  const shutdown = async (signal: string): Promise<void> => {
    clearInterval(staleWorkerTimer);
    if (schedulerTimer) clearInterval(schedulerTimer);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await pool.end();
    console.log(`Control plane stopped after ${signal}`);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, () => {
      console.log(`Control plane listening on http://${config.host}:${config.port}`);
      resolve();
    });
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown control-plane failure";
  console.error(`Control-plane startup failed: ${message}`);
  process.exitCode = 1;
});
