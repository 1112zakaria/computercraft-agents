import { z } from "zod";

export const reasoningVersion = "0.1.0" as const;

export type ReasoningTier = "fast" | "standard" | "strong";

const IdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const TaskProposalSchema = z
  .object({
    skillName: z.string().min(1).max(128),
    arguments: z.record(z.string(), z.unknown()).default({}),
    requiredCapabilities: z.array(z.string().min(1).max(128)).max(64).default([]),
    priority: z.number().int().min(-1000).max(1000).default(0),
  })
  .strict();

export const PlannerDecisionSchema = z.union([
  z
    .object({
      kind: z.literal("plan"),
      summary: z.string().min(1).max(4096),
      tasks: z.array(TaskProposalSchema).min(1).max(64),
    })
    .strict(),
  z.object({ kind: z.literal("create-task"), task: TaskProposalSchema }).strict(),
  z
    .object({
      kind: z.literal("continue"),
      taskId: IdentifierSchema,
      skillName: z.string().min(1).max(128),
      arguments: z.record(z.string(), z.unknown()).default({}),
      reason: z.string().min(1).max(1024),
    })
    .strict(),
  z
    .object({
      kind: z.literal("delegate"),
      taskId: IdentifierSchema,
      targetWorkerId: IdentifierSchema.optional(),
      targetGroup: IdentifierSchema.optional(),
      reason: z.string().min(1).max(1024),
    })
    .strict()
    .refine((decision) => decision.targetWorkerId || decision.targetGroup, {
      message: "delegate requires targetWorkerId or targetGroup",
    }),
  z.object({ kind: z.literal("replan"), reason: z.string().min(1).max(1024) }).strict(),
  z.object({ kind: z.literal("refuse"), reason: z.string().min(1).max(1024) }).strict(),
  z
    .object({
      kind: z.literal("report"),
      status: z.enum(["PROGRESS", "COMPLETED", "BLOCKED", "FAILED"]),
      summary: z.string().min(1).max(4096),
    })
    .strict(),
]);

export type PlannerDecision = z.infer<typeof PlannerDecisionSchema>;

export interface ReasoningRequest {
  readonly requestId: string;
  readonly prompt: string;
  readonly tier: ReasoningTier;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface ReasoningResult {
  readonly requestId: string;
  readonly provider: string;
  readonly decision: PlannerDecision;
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface ReasoningProvider {
  decide(request: ReasoningRequest): Promise<ReasoningResult>;
}

/** Deterministic provider for tests and offline planner development. */
export class FakeReasoningProvider implements ReasoningProvider {
  public readonly requests: ReasoningRequest[] = [];

  public constructor(private readonly responses: readonly unknown[]) {}

  public async decide(request: ReasoningRequest): Promise<ReasoningResult> {
    if (!request.requestId || request.timeoutMs <= 0) {
      throw new Error("fake reasoning request must have an id and positive timeout");
    }
    if (request.signal?.aborted) {
      throw new Error("reasoning request was cancelled");
    }
    this.requests.push(request);
    const response = this.responses[this.requests.length - 1];
    if (response === undefined) {
      throw new Error("fake reasoning response queue is exhausted");
    }
    const startedAt = new Date().toISOString();
    const decision = PlannerDecisionSchema.parse(response);
    const completedAt = new Date().toISOString();
    return {
      requestId: request.requestId,
      provider: "fake",
      decision,
      startedAt,
      completedAt,
    };
  }
}
