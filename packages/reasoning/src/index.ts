export const reasoningVersion = "0.1.0" as const;

export type ReasoningTier = "fast" | "standard" | "strong";

export interface ReasoningRequest {
  readonly prompt: string;
  readonly tier: ReasoningTier;
  readonly timeoutMs: number;
}

export interface ReasoningProvider {
  decide(request: ReasoningRequest): Promise<unknown>;
}
