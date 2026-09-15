import { z } from "zod";
import { StepNameSchema } from "./stepName";

// TRD.md §8 GET /api/runs: metadata only. Deliberately narrower than a Violation
// (lib/contracts/violation.ts) — the rule id, not its message, since a message can echo
// LLM-generated content back into a public listing; never raw_output, idea text of a
// non-succeeded run, or an IP hash (TRD.md §4 run_steps.raw_output, runs.client_ip_hash).
export const RunSummarySchema = z.object({
  id: z.string(),
  created_at: z.string(),
  status: z.enum(["running", "succeeded", "rejected", "error"]),
  category: z.string(),
  // Only a succeeded run's idea is public — a rejected/errored one may have tripped a
  // guardrail (banned word, safety block) precisely because of what it said.
  idea: z.string().optional(),
  // Two shapes, matching runs.failure (TRD.md §4): a guardrail rejection names its rule ids
  // (no message — see the module comment); a transport failure names its reason code instead,
  // since there were no rules to violate.
  failure: z
    .union([
      z.object({ step: z.union([StepNameSchema, z.literal("input")]), rules: z.array(z.string()) }),
      z.object({ step: StepNameSchema, error: z.enum(["timeout", "provider_error", "quota_exhausted", "aborted"]) }),
    ])
    .optional(),
  models: z.partialRecord(StepNameSchema, z.string()),
  quality_retries: z.number(),
  transport_retries: z.number(),
  latency_ms: z.number().nullable(),
  tokens: z.object({ input: z.number(), output: z.number(), thinking: z.number() }),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const RunsResponseSchema = z.object({
  runs: z.array(RunSummarySchema),
  next_cursor: z.string().nullable(),
});
