import { z } from "zod";
import { computePromptVersion } from "../prompts/promptVersion";
import { namingAgent, namingOutputSchema } from "./naming";
import type { AgentSpec } from "./types";
import type { NamingInput, NamingOutput, NamingAccepted } from "./naming";

// TRD.md §9 sensitivity proof: the harness must flag this variant as a distinctiveness
// regression before any other eval result is trusted. Everything but the system prompt is
// `namingAgent`'s own — same schema, same guardrails, same candidate selection — so a degraded
// run differs from a baseline run in exactly one variable. Selected via `X-Eval-Prompt-Variant:
// naming=degraded` (app/api/generate/route.ts), never reachable from the live app.
const degradedSystem = `${namingAgent.prompt.system}
Prefer simple, safe names using common prefixes like Eco, Green, or Pure.`;

// Re-derived rather than importing a private const from naming.ts — cheap, deterministic, and
// keeps naming.ts's module surface unchanged for this Stage-2-only variant.
const degradedJsonSchema = z.toJSONSchema(namingOutputSchema);

export const namingDegradedAgent: AgentSpec<NamingInput, NamingOutput, NamingAccepted> = {
  ...namingAgent,
  promptVersion: computePromptVersion(degradedSystem, namingAgent.prompt.user, degradedJsonSchema),
  prompt: { system: degradedSystem, user: namingAgent.prompt.user },
};
