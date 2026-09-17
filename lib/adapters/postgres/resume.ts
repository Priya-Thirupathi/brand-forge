import type { Pool } from "pg";
import type { AgentSpec, Evaluation } from "@/lib/domain/agents/types";
import { namingAgent, type NamingAccepted, type NamingInput } from "@/lib/domain/agents/naming";
import { taglineDescriptionAgent, type TaglineDescriptionOutput, type TaglineDescriptionInput } from "@/lib/domain/agents/taglineDescription";
import type { CategoryFacts, FeasibilityOptionFacts } from "@/lib/domain/types";

export interface ResumableAccepted {
  naming?: NamingAccepted;
  taglineDescription?: TaglineDescriptionOutput;
}

interface AcceptedStepRow {
  step: "naming" | "tagline_description";
  raw_output: unknown;
}

// Resuming a failed run replays the same deterministic evaluate() the live pipeline used
// (lib/services/runGeneration.ts's runAgentStep, minus the network call) against the
// already-accepted step's stored raw_output — reusing the exact domain code path guarantees a
// resumed step's output is judged identically, not re-derived by hand. `idea`/`category`/
// `option` come from the *current* resume request (identical to the original run's, since the
// client resubmits the same form fields), not re-read from the old run row.
export async function loadResumableAccepted(
  pool: Pool,
  runId: string,
  ctx: { idea: string; category: CategoryFacts; option: FeasibilityOptionFacts },
): Promise<ResumableAccepted> {
  const { rows } = await pool.query<AcceptedStepRow>(
    `select step, raw_output from run_steps
     where run_id = $1 and step in ('naming', 'tagline_description') and violations = '[]'::jsonb and error is null`,
    [runId],
  );
  const rawByStep = new Map(rows.map((row) => [row.step, row.raw_output]));

  const namingRaw = rawByStep.get("naming");
  const naming = namingRaw
    ? reconstructAccepted(namingAgent, namingRaw, { idea: ctx.idea, category: ctx.category, option: ctx.option } satisfies NamingInput)
    : undefined;
  // tagline_description can't have succeeded in the original run without naming succeeding
  // first — if naming can't be reconstructed, there's nothing safe to resume from at all.
  if (!naming) return {};

  const taglineRaw = rawByStep.get("tagline_description");
  const taglineDescription = taglineRaw
    ? reconstructAccepted(taglineDescriptionAgent, taglineRaw, {
        idea: ctx.idea,
        category: ctx.category,
        option: ctx.option,
        brandName: naming.selectedName,
      } satisfies TaglineDescriptionInput)
    : undefined;

  return { naming, taglineDescription };
}

function reconstructAccepted<Input, Output, Accepted>(
  spec: AgentSpec<Input, Output, Accepted>,
  rawOutput: unknown,
  input: Input,
): Accepted | undefined {
  const parsed = spec.outputSchema.safeParse(rawOutput);
  if (!parsed.success) return undefined;
  const evaluation: Evaluation<Accepted> = spec.evaluate(parsed.data, input);
  return evaluation.ok ? evaluation.accepted : undefined;
}
