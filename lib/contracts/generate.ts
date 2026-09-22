import { z } from "zod";
import { IDEA_LENGTH } from "@/config/limits";
import { StepNameSchema } from "./stepName";
import { ViolationSchema } from "./violation";

// TRD.md §8 POST /api/generate request. `feasibility_option_id` is optional — the route
// resolves it to the category's default via GenerationStore.findOption when omitted.
export const GenerateRequestSchema = z.object({
  idea: z.string().trim().min(IDEA_LENGTH.min).max(IDEA_LENGTH.max),
  category: z.string(),
  feasibility_option_id: z.string().uuid().optional(),
  // Retrying a run that previously ended `status: "error"` after at least one step already
  // succeeded — the route replays that run's already-accepted steps (lib/adapters/postgres/
  // resume.ts) instead of redoing them. Absent, this is an ordinary fresh generation.
  resume_from_run_id: z.string().uuid().optional(),
  // Stage 5, item 2 (D29): a new product for an existing, already-named brand — naming is
  // skipped and tone_notes carry over unchanged. Never set together with resume_from_run_id in
  // practice (different flows).
  follow_up_brand_id: z.string().uuid().optional(),
  // Stage 5, item 3 (D30): regenerate the copy around a different name the naming step already
  // produced. `alternate_name` is never trusted as text — the route re-derives that run's
  // candidate set from its stored naming output and requires this to be one that passed the
  // name rules (D8 deliberately rejected accepting a free-text name here).
  regenerate_from_run_id: z.string().uuid().optional(),
  alternate_name: z.string().optional(),
})
  // Either both or neither: `regenerate_from_run_id` alone has no name to select, and
  // `alternate_name` alone has no candidate set to validate it against. Caught here so the
  // route never has to express "half a regenerate" as a runtime branch.
  .refine((body) => Boolean(body.regenerate_from_run_id) === Boolean(body.alternate_name), {
    message: "regenerate_from_run_id and alternate_name must be sent together",
    path: ["alternate_name"],
  });
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

const ToneNotesSchema = z.object({
  voice: z.array(z.string()),
  audience: z.string(),
  personality: z.string(),
  avoid: z.array(z.string()),
});

const PackagingSchema = z.object({
  headline: z.string(),
  body: z.string(),
  callouts: z.array(z.string()),
});

const FeasibilitySchema = z.object({
  material: z.string(),
  cost_low: z.number(),
  cost_high: z.number(),
  currency: z.string(),
  moq: z.number(),
  lead_time_days_low: z.number(),
  lead_time_days_high: z.number(),
  assumptions: z.string(),
  first_run_cost_low: z.number(),
  first_run_cost_high: z.number(),
});

const NameCandidateSchema = z.object({
  name: z.string(),
  selected: z.boolean(),
});

// TransportFailureReason (lib/services/ports.ts) mapped to the stream's error vocabulary —
// "timeout" becomes "deadline_exceeded" so the client never has to know an internal retry
// budget expired vs. genuinely missing its 25s run deadline (TRD.md §8).
export const GenerateErrorCodeSchema = z.enum(["quota_exhausted", "deadline_exceeded", "provider_error", "aborted", "internal"]);
export type GenerateErrorCode = z.infer<typeof GenerateErrorCodeSchema>;

export const GenerateResultSchema = z.object({
  run_id: z.string(),
  status: z.enum(["succeeded", "rejected"]),
  feasibility: FeasibilitySchema,
  brand: z.object({ id: z.string(), name: z.string(), tone_notes: ToneNotesSchema }).optional(),
  product: z.object({ id: z.string(), tagline: z.string(), description: z.string(), packaging: PackagingSchema }).optional(),
  name_candidates: z.array(NameCandidateSchema).optional(),
  // D34: this result was served from an earlier identical request, not generated now. Set only
  // on a cache hit, so an ordinary result's payload is unchanged.
  from_cache: z.boolean().optional(),
  guardrails: z.object({
    quality_retries: z.number(),
    failure: z
      .object({
        step: z.union([StepNameSchema, z.literal("input")]),
        violations: z.array(ViolationSchema),
      })
      .optional(),
  }),
  meta: z.object({
    // TRD.md §8 types these as full `Record<StepName, string>`, but a run that never reaches
    // a later step (rejected/errored early) genuinely has no model or prompt version for it —
    // `partialRecord` matches RunMeta (lib/services/runGeneration.ts), not a spec that assumes
    // every run completes all three steps.
    models: z.partialRecord(StepNameSchema, z.string()),
    prompt_versions: z.partialRecord(StepNameSchema, z.string()),
    latency_ms: z.number(),
    transport_retries: z.number(),
    tokens: z.object({ input: z.number(), output: z.number(), thinking: z.number() }),
  }),
});
export type GenerateResult = z.infer<typeof GenerateResultSchema>;

export const GenerateEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run_started"), run_id: z.string() }),
  z.object({ type: z.literal("step_started"), step: StepNameSchema }),
  z.object({ type: z.literal("step_finished"), step: StepNameSchema, attempt: z.union([z.literal(1), z.literal(2)]), passed: z.boolean() }),
  z.object({ type: z.literal("result"), result: GenerateResultSchema }),
  // `step` tells the client whether anything is resumable: `"naming"` means nothing succeeded
  // yet (an ordinary retry is the only option), anything else means at least one earlier step
  // did, so a resume request against this run_id can skip it.
  z.object({ type: z.literal("error"), run_id: z.string(), code: GenerateErrorCodeSchema, message: z.string(), step: StepNameSchema }),
]);
export type GenerateEvent = z.infer<typeof GenerateEventSchema>;
