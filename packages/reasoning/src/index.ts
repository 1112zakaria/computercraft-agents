import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
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

export interface CodexCliExecutionInput {
  readonly executable: string;
  readonly args: readonly string[];
  readonly prompt: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly cwd?: string;
}

export type CodexCliExecutor = (input: CodexCliExecutionInput) => Promise<string>;

export interface CodexCliProviderOptions {
  readonly executable?: string;
  readonly cwd?: string;
  readonly model?: string;
  readonly profile?: string;
  readonly execute?: CodexCliExecutor;
}

const broadJsonOutputSchema = {
  type: "object",
  properties: { kind: { type: "string" } },
  required: ["kind"],
  additionalProperties: true,
};

function safeChildEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "ComSpec",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "CODEX_HOME",
    "TMP",
    "TEMP",
  ]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  if (environment.PATH === undefined && environment.Path === undefined) {
    environment.PATH = [process.cwd(), "node_modules/.bin"].join(delimiter);
  }
  return environment;
}

async function executeCodexCli(input: CodexCliExecutionInput): Promise<string> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "computercraft-agents-codex-"));
  const schemaPath = join(temporaryDirectory, "decision-schema.json");
  const outputPath = join(temporaryDirectory, "decision.json");
  await writeFile(schemaPath, `${JSON.stringify(broadJsonOutputSchema)}\n`, "utf8");

  try {
    const args = [
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      ...input.args.slice(0),
      "-",
    ];
    const child = spawn(input.executable, args, {
      cwd: input.cwd,
      env: safeChildEnvironment(),
      stdio: ["pipe", "ignore", "pipe"],
      shell: false,
    });
    child.stderr.resume();

    const exitCode = await new Promise<number>((resolve, reject) => {
      const onAbort = () => {
        child.kill();
        reject(new Error("Codex CLI execution was cancelled"));
      };
      if (input.signal.aborted) {
        onAbort();
        return;
      }
      input.signal.addEventListener("abort", onAbort, { once: true });
      child.once("error", (error) => {
        input.signal.removeEventListener("abort", onAbort);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        input.signal.removeEventListener("abort", onAbort);
        if (signal) {
          reject(new Error(`Codex CLI terminated by ${signal}`));
        } else {
          resolve(code ?? 1);
        }
      });
      child.stdin.end(input.prompt);
    });

    if (exitCode !== 0) {
      throw new Error(`Codex CLI failed with exit code ${exitCode}`);
    }
    return await readFile(outputPath, "utf8");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function structuredPrompt(prompt: string): string {
  return [
    "You are the planning component for a ComputerCraft worker system.",
    "Return exactly one JSON object and no markdown.",
    "The JSON must be one of the validated planner decisions: plan, create-task, continue, delegate, replan, refuse, or report.",
    "Do not execute commands, modify files, or propose raw Lua; describe bounded semantic skills only.",
    "User/context input:",
    prompt,
  ].join("\n\n");
}

/** Production boundary for Codex CLI planning. It is read-only and never executes model output. */
export class CodexCliProvider implements ReasoningProvider {
  private readonly executable: string;
  private readonly execute: CodexCliExecutor;

  public constructor(private readonly options: CodexCliProviderOptions = {}) {
    this.executable = options.executable ?? "codex";
    this.execute = options.execute ?? executeCodexCli;
  }

  public async decide(request: ReasoningRequest): Promise<ReasoningResult> {
    if (!request.requestId || request.timeoutMs <= 0) {
      throw new Error("Codex reasoning request must have an id and positive timeout");
    }
    if (request.signal?.aborted) {
      throw new Error("Codex reasoning request was cancelled");
    }

    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    request.signal?.addEventListener("abort", abortFromCaller, { once: true });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<string>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("Codex reasoning request timed out"));
      }, request.timeoutMs);
    });
    const cancellation = request.signal
      ? new Promise<string>((_, reject) => {
          request.signal!.addEventListener(
            "abort",
            () => reject(new Error("Codex reasoning request was cancelled")),
            { once: true },
          );
        })
      : undefined;
    try {
      const args = [
        ...(this.options.model ? ["--model", this.options.model] : []),
        ...(this.options.profile ? ["--profile", this.options.profile] : []),
      ];
      const execution = this.execute({
        executable: this.executable,
        args,
        prompt: structuredPrompt(request.prompt),
        timeoutMs: request.timeoutMs,
        signal: controller.signal,
        cwd: this.options.cwd,
      });
      const raw = await Promise.race(
        cancellation ? [execution, deadline, cancellation] : [execution, deadline],
      );
      const decision = PlannerDecisionSchema.parse(JSON.parse(raw));
      return {
        requestId: request.requestId,
        provider: "codex-cli",
        decision,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}
