import { z } from "zod";

// Shared by the API contract (TRD.md §8, GenerateResult.guardrails.failure.step) and the
// domain's agent specs. Contracts may only import zod [D23] — this is the innermost shared
// vocabulary, not the full request/response/stream-event contracts (those arrive with the
// API routes in a later build step).
export const StepNameSchema = z.enum(["naming", "tagline_description", "packaging"]);
export type StepName = z.infer<typeof StepNameSchema>;
