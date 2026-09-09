import type {
  AuditEventRepository,
  GatewayRuntimeRepository,
  PlannerRuntimeStateRecord,
  PlannerTriggerRecord,
} from "@computercraft-agents/database";
import {
  CodexCliProvider,
  PlannerTriggerRunner,
  PlannerTriggerSchema,
  PlannerTriggerService,
  ReasoningConcurrencyLimiter,
  ReasoningOutageStateMachine,
  type ReasoningOutageSnapshot,
  type PlannerTriggerQueue,
} from "@computercraft-agents/reasoning";

import type { Logger } from "./logger";

interface PlannerRuntimeConfig {
  readonly plannerBatchSize: number;
  readonly plannerTimeoutMs: number;
  readonly plannerMaxConcurrent: number;
  readonly plannerClaimLeaseSeconds: number;
  readonly plannerReasoningTier: "fast" | "standard" | "strong";
  readonly codexCommand: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function triggerFromRecord(record: PlannerTriggerRecord) {
  return PlannerTriggerSchema.parse({
    triggerId: record.triggerId,
    cause: record.cause,
    subjectId: record.subjectId,
    occurredAt: record.occurredAt,
    priority: record.priority,
  });
}

export async function createPlannerRunner(
  repository: GatewayRuntimeRepository,
  auditEvents: AuditEventRepository,
  config: PlannerRuntimeConfig,
  logger: Logger,
): Promise<PlannerTriggerRunner> {
  const persisted = await repository.getPlannerRuntimeState();
  const outage = new ReasoningOutageStateMachine({
    initial: plannerOutageSnapshot(persisted),
    onChange: (snapshot) => {
      void repository.savePlannerRuntimeState(snapshot).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unknown outage persistence error";
        logger.error("planner.outage.persistence.failed", { error: message, outcome: "error" });
      });
    },
  });
  const provider = new ReasoningConcurrencyLimiter(
    new CodexCliProvider({ executable: config.codexCommand }),
    config.plannerMaxConcurrent,
  );
  const service = new PlannerTriggerService({
    provider,
    outage,
    tier: config.plannerReasoningTier,
    timeoutMs: config.plannerTimeoutMs,
    assembleContext: async (trigger) => {
      const task = await repository.getTask(trigger.subjectId);
      const taskArguments = isRecord(task?.arguments) ? task.arguments : {};
      const workerId =
        typeof task?.assignedWorkerId === "string"
          ? task.assignedWorkerId
          : typeof taskArguments.targetWorkerId === "string"
            ? taskArguments.targetWorkerId
            : trigger.cause === "worker.blocked"
              ? trigger.subjectId
              : undefined;
      return {
        goalText:
          typeof task?.goalText === "string" ? task.goalText : `planner trigger ${trigger.cause}`,
        task: task ?? null,
        worker: workerId ? await repository.getWorker(workerId) : null,
        skills: stringList(task?.requiredCapabilities),
        worldKnowledge: await repository.listWorldCells(),
        memories: [],
        recentConversation: [],
      };
    },
  });

  const queue: PlannerTriggerQueue = {
    claim: async (limit) => {
      await repository.requeueStalePlannerTriggers(config.plannerClaimLeaseSeconds);
      return (await repository.claimPlannerTriggers(limit)).map(triggerFromRecord);
    },
    complete: (triggerId, status, error) =>
      repository.completePlannerTrigger(triggerId, status, error),
    release: (triggerId, error) => repository.releasePlannerTrigger(triggerId, error),
  };

  return new PlannerTriggerRunner(
    queue,
    service,
    {
      async apply(trigger, result) {
        await auditEvents.append({
          category: "planner.decision.recorded",
          action: { trigger },
          result: {
            requestId: result.requestId,
            provider: result.provider,
            decision: result.decision,
            applied: false,
            mode: "plan-only",
          },
          retentionClass: "HIGH",
        });
        logger.info("planner.decision.recorded", {
          taskId: trigger.subjectId,
          outcome: "plan-only",
          status: result.decision.kind,
        });
      },
    },
    config.plannerBatchSize,
  );
}

function plannerOutageSnapshot(record: PlannerRuntimeStateRecord): ReasoningOutageSnapshot {
  return {
    state: record.state,
    consecutiveFailures: record.consecutiveFailures,
    lastFailureAt: record.lastFailureAt,
    retryAfter: record.retryAfter,
  };
}
