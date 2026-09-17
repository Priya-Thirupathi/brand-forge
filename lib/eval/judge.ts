import { z } from "zod";
import { JudgeResultSchema, type JudgeResult } from "@/lib/contracts/eval";
import { renderTemplate } from "@/lib/domain/prompts/render";
import type { LlmClient } from "@/lib/services/ports";

// TRD.md §9 "Judge": a pinned model, preferably a different generation than the generator
// (MODEL_STRONG/MODEL_CHEAP, both `strong` tier per config/routing.ts — see D-rationale below),
// scoring a succeeded case's actual output against the idea it came from.
export function resolveJudgeModel(): string {
  if (process.env.JUDGE_MODEL) return process.env.JUDGE_MODEL;
  if (process.env.NODE_ENV !== "production" && process.env.LOCAL_LLM_PROVIDER === "qwen") {
    // D26: Qwen (via Groq) exposes one model locally, no distinct "cheap" tier — using it for
    // both generation and judging trades TRD.md §9's "preferably a different generation"
    // preference for not burning Gemini's scarce daily quota during local eval development.
    return process.env.MODEL_CHEAP ?? "qwen/qwen3.8-27b";
  }
  return "gemini-3.5-flash-lite";
}

export interface JudgeInput {
  idea: string;
  category: string;
  name: string;
  tagline: string;
  description: string;
}

export type JudgeOutcome = { kind: "ok"; result: JudgeResult } | { kind: "failed"; reason: string };

const judgeJsonSchema = z.toJSONSchema(JudgeResultSchema);

const SYSTEM = `You are a strict branding critic judging whether an AI-generated brand kit actually fits the product idea it was built from.

Score two things, each 0 to 1:
- relevance: does the name, tagline, and description clearly fit the stated idea and category? 1.0 = obviously fits; 0.5 = generic enough to fit almost anything; 0.0 = unrelated or contradicts the idea.
- distinctiveness: is the name original and memorable, or a cliche? Treat any name built from a generic prefix like "Eco", "Green", "Pure", "Nova", or "Prime" glued to the category word as low distinctiveness (0.0-0.2), regardless of relevance.

Respond with the required JSON only: {relevance, distinctiveness, reason}. reason is one sentence explaining the lower of the two scores.`;

const USER = `<idea>
{{idea}}
</idea>
Category: {{category}}

<brand_kit>
Name: {{name}}
Tagline: {{tagline}}
Description: {{description}}
</brand_kit>`;

export async function judgeBrand(llmClient: LlmClient, input: JudgeInput, deadlineAt: number): Promise<JudgeOutcome> {
  const vars = { idea: input.idea, category: input.category, name: input.name, tagline: input.tagline, description: input.description };
  const outcome = await llmClient.generateJson({
    model: resolveJudgeModel(),
    system: SYSTEM,
    user: renderTemplate(USER, vars),
    responseJsonSchema: judgeJsonSchema,
    deadlineAt,
  });

  if (outcome.kind === "prompt_blocked") return { kind: "failed", reason: "prompt_blocked" };
  if (outcome.kind === "response_blocked") return { kind: "failed", reason: "response_blocked" };
  if (outcome.kind === "failed") return { kind: "failed", reason: outcome.error };

  const parsed = JudgeResultSchema.safeParse(outcome.json);
  if (!parsed.success) return { kind: "failed", reason: "invalid_json" };
  return { kind: "ok", result: parsed.data };
}
