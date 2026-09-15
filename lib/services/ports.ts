// Ports the service layer orchestrates against (TRD.md §5 "Ports", clean-code structure
// D23). Adapters implement these; only the pieces a built adapter actually uses are declared
// so far — GenerationStore lands with the Postgres adapter.

export interface Clock {
  now(): number;
}

export interface LlmRequest {
  model: string;
  system: string;
  user: string;
  // From `z.toJSONSchema(agentSpec.outputSchema)` — the adapter treats it as opaque.
  responseJsonSchema: unknown;
  // Epoch ms the run must finish by; the adapter's transport retry never starts a retry that
  // can't complete before this (TRD.md §5 "Timeouts and retries").
  deadlineAt: number;
  // Client disconnect cancels in-flight calls (TRD.md §5).
  signal?: AbortSignal;
}

export interface TokenUsage {
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
}

// LlmClient never throws for provider failures (TRD.md §5) — every outcome, including
// safety blocks and exhausted retries, is a value the service layer pattern-matches on.
export type LlmOutcome =
  | { kind: "ok"; json: unknown; usage: TokenUsage; transportRetries: number; latencyMs: number }
  | { kind: "prompt_blocked"; transportRetries: number; latencyMs: number }
  | { kind: "response_blocked"; usage: TokenUsage; transportRetries: number; latencyMs: number }
  | {
      kind: "failed";
      error: "timeout" | "provider_error" | "quota_exhausted" | "invalid_json" | "aborted";
      message: string;
      transportRetries: number;
      latencyMs: number;
    };

export interface LlmClient {
  generateJson(request: LlmRequest): Promise<LlmOutcome>;
}
