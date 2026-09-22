import { z } from "zod";
import { JudgeResultSchema, ToneFitResultSchema, type JudgeResult, type ToneFitResult } from "@/lib/contracts/eval";
import { renderTemplate } from "@/lib/domain/prompts/render";
import type { LlmClient } from "@/lib/services/ports";

// TRD.md §9 "Judge": a pinned model, preferably a different generation than the generator
// (MODEL_STRONG/MODEL_CHEAP, both `strong` tier per config/routing.ts — see D-rationale below),
// scoring a succeeded case's actual output against the idea it came from.
export function resolveJudgeModel(): string {
  if (process.env.JUDGE_MODEL) return process.env.JUDGE_MODEL;
  if (process.env.LLM_PROVIDER === "qwen") {
    // D26 (revised 2026-09-20): Qwen (via Groq) exposes one model, no distinct "cheap" tier —
    // using it for both generation and judging trades TRD.md §9's "preferably a different
    // generation" preference for not burning Gemini's scarce daily quota, in production now too.
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

// D31: the consistency dimension for a brand follow-up (D29). Deliberately does NOT compare
// tone_notes to tone_notes — those match by construction, because evaluate() substitutes the
// existing brand's notes and discards whatever the model returned, so checking them would
// always score 1.0 and measure nothing. What is genuinely unknown is whether the *prose* the
// model wrote actually reads in that voice, which is what this asks.
const TONE_FIT_SYSTEM = `You are judging whether a piece of product copy was written in a brand voice you are given.

You will be given a brand's voice definition and a new product's copy. The copy is for a different product than the one the voice was originally written for — that is expected and is not itself a problem.

Score one thing, 0 to 1:
- tone_fit: does the copy read as though written by the same brand, in the given voice? 1.0 = the voice is unmistakable in the word choice and rhythm; 0.5 = neutral copy that neither matches nor contradicts it; 0.0 = actively contradicts the voice, or reads as a different brand entirely.

Judge the writing, not the subject matter. Do not reward the copy for repeating the voice definition's own adjectives back; reward it for sounding that way. Penalise copy that describes an audience the voice definition excludes.

Respond with the required JSON only: {tone_fit, reason}. reason is one sentence.`;

const TONE_FIT_USER = `<brand_voice>
Voice: {{voice}}
Audience: {{audience}}
Personality: {{personality}}
Avoid: {{avoid}}
</brand_voice>

<copy>
Name: {{name}}
Tagline: {{tagline}}
Description: {{description}}
</copy>`;

export interface ToneFitInput {
  toneNotes: { voice: string[]; audience: string; personality: string; avoid: string[] };
  name: string;
  tagline: string;
  description: string;
}

export type ToneFitOutcome = { kind: "ok"; result: ToneFitResult } | { kind: "failed"; reason: string };

export async function judgeToneFit(llmClient: LlmClient, input: ToneFitInput, deadlineAt: number): Promise<ToneFitOutcome> {
  const outcome = await llmClient.generateJson({
    model: resolveJudgeModel(),
    system: TONE_FIT_SYSTEM,
    user: renderTemplate(TONE_FIT_USER, {
      voice: input.toneNotes.voice.join(", "),
      audience: input.toneNotes.audience,
      personality: input.toneNotes.personality,
      avoid: input.toneNotes.avoid.join(", ") || "nothing specified",
      name: input.name,
      tagline: input.tagline,
      description: input.description,
    }),
    responseJsonSchema: z.toJSONSchema(ToneFitResultSchema),
    deadlineAt,
  });

  if (outcome.kind === "prompt_blocked") return { kind: "failed", reason: "prompt_blocked" };
  if (outcome.kind === "response_blocked") return { kind: "failed", reason: "response_blocked" };
  if (outcome.kind === "failed") return { kind: "failed", reason: outcome.error };

  const parsed = ToneFitResultSchema.safeParse(outcome.json);
  if (!parsed.success) return { kind: "failed", reason: "invalid_json" };
  return { kind: "ok", result: parsed.data };
}
