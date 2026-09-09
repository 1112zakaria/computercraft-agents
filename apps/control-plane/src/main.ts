import {
  AuditEventRepository,
  createDatabasePool,
  GatewayRuntimeRepository,
  runMigrations,
} from "@computercraft-agents/database";

import { loadConfig } from "./config";
import { createRepositoryService } from "./gateway-service";
import { createControlPlaneServer } from "./http";
import { createLogger } from "./logger";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger();
  logger.info("control_plane.starting", {
    nodeEnv: config.nodeEnv,
    host: config.host,
    port: config.port,
    schedulerEnabled: config.schedulerEnabled,
  });
  const pool = createDatabasePool(config.databaseUrl);
  await runMigrations(pool);
  const auditEvents = new AuditEventRepository(pool);

  const repository = new GatewayRuntimeRepository(pool, {
    gatewayTimeoutSeconds: config.gatewayTimeoutSeconds,
    workerTimeoutSeconds: config.workerTimeoutSeconds,
  });
  const restartRecovery = await repository.reconcileControlPlaneRestart();
  logger.info("control_plane.recovery.reconciled", {
    workerCount: restartRecovery.workerCount,
    commandCount: restartRecovery.commandCount,
    outcome: "success",
  });
  const service = createRepositoryService(
    repository,
    config.gatewayBearerSecret,
    config.adminSecret,
    config.enabledSkills,
  );
  const server = createControlPlaneServer({
    service,
    maxBodyBytes: config.maxHttpBodyBytes,
    logger,
  });

  let schedulerInFlight = false;
  const schedulerTimer = config.schedulerEnabled
    ? setInterval(() => {
        if (schedulerInFlight) return;
        schedulerInFlight = true;
        void service
          .dispatchRunnableTasks()
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "unknown scheduler failure";
            logger.error("scheduler.tick.failed", { error: message, outcome: "error" });
          })
          .finally(() => {
            schedulerInFlight = false;
          });
      }, config.schedulerIntervalSeconds * 1000)
    : undefined;

  const staleWorkerTimer = setInterval(() => {
    void repository.markStale().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown stale-worker failure";
      logger.error("worker.recovery.check.failed", { error: message, outcome: "error" });
    });
  }, config.staleCheckIntervalSeconds * 1000);

  let cleanupInFlight = false;
  const cleanupAuditEvents = (): void => {
    if (cleanupInFlight) return;
    cleanupInFlight = true;
    void auditEvents
      .cleanupExpired({
        standardRetentionDays: config.auditStandardRetentionDays,
        highRetentionDays: config.auditHighRetentionDays,
      })
      .then((deleted) => {
        if (deleted.standard > 0 || deleted.high > 0) {
          logger.info("audit.retention.cleaned", {
            standardDeleted: deleted.standard,
            highDeleted: deleted.high,
            outcome: "success",
          });
        }
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "unknown retention cleanup failure";
        logger.error("audit.retention.cleanup.failed", { error: message, outcome: "error" });
      })
      .finally(() => {
        cleanupInFlight = false;
      });
  };
  cleanupAuditEvents();
  const retentionCleanupTimer = setInterval(
    cleanupAuditEvents,
    config.retentionCleanupIntervalSeconds * 1000,
  );

  const shutdown = async (signal: string): Promise<void> => {
    clearInterval(staleWorkerTimer);
    clearInterval(retentionCleanupTimer);
    if (schedulerTimer) clearInterval(schedulerTimer);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await pool.end();
    logger.info("control_plane.stopped", { signal, outcome: "shutdown" });
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, () => {
      logger.info("control_plane.ready", { host: config.host, port: config.port });
      resolve();
    });
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown control-plane failure";
  createLogger().error("control_plane.startup.failed", { error: message, outcome: "error" });
  process.exitCode = 1;
});
