import type { Pool } from "pg";
import { StepNameSchema, type StepName } from "@/lib/contracts/stepName";
import type { GenerateResult } from "@/lib/contracts/generate";
import { resolveModel } from "@/config/routing";
import { STORED_RESULT_COLUMNS, buildStoredResult, stepMetaOf, type RunProductBrandRow, type RunStepRow } from "./storedResult";

export interface CacheKey {
  idea: string;
  category: string;
  feasibilityOptionId: string;
  // The prompt versions the *current* code would use — content hashes (D17), so any edit to a
  // prompt makes this a miss rather than serving copy the current prompts wouldn't produce.
  promptVersions: Partial<Record<StepName, string>>;
}

// How many exact-idea matches to inspect before giving up. Normally 0 or 1; more only when the
// same idea was generated under several prompt/model configurations over time.
const CANDIDATE_LIMIT = 5;

// D34, Stage 5 item 6: an identical request returns the identical stored result instead of
// spending three model calls on it. The cache *is* the `runs` table — a hit returns the run,
// brand and product that already exist, so nothing new is written and the gallery doesn't grow
// a duplicate card for work that was never done.
//
// Matching is deliberately strict. Idea text must match exactly once trimmed and lowercased —
// no fuzzy matching, no embeddings, because "close enough" would serve a founder copy written
// for somebody else's product. Category and feasibility option must match, since both feed the
// prompts. Prompt versions and the per-step model must match too: this project swapped its
// whole provider in production (D2, Gemini → Qwen), and a cache keyed only on the input would
// have gone on serving the old provider's copy indefinitely.
export async function findCachedRun(pool: Pool, key: CacheKey): Promise<GenerateResult | null> {
  const { rows } = await pool.query<RunProductBrandRow>(
    `select ${STORED_RESULT_COLUMNS}
     from runs r
     join products p on p.run_id = r.id
     join brands b on b.id = p.brand_id
     where r.status = 'succeeded'
       and r.source = 'user'
       and p.hidden = false and b.hidden = false
       and r.category = $1
       and r.feasibility_option_id = $2
       and lower(btrim(r.idea)) = lower(btrim($3))
       and r.prompt_versions = $4::jsonb
     order by r.created_at desc
     limit ${CANDIDATE_LIMIT}`,
    [key.category, key.feasibilityOptionId, key.idea, JSON.stringify(key.promptVersions)],
  );
  if (rows.length === 0) return null;

  for (const row of rows) {
    const { rows: stepRows } = await pool.query<RunStepRow>(
      `select step, attempt, model, prompt_version, latency_ms, violations, error
       from run_steps where run_id = $1 order by created_at asc`,
      [row.run_id],
    );
    if (stepRows.length === 0) continue;
    if (!modelsStillMatch(stepRows)) continue;
    return buildStoredResult(row, stepRows);
  }
  return null;
}

// Every step the stored run recorded must have used the model that step would resolve to now.
// A run that skipped a step (a follow-up or regenerate, which never call naming) is not a cache
// candidate at all: its copy was shaped by inputs — an inherited tone, a pinned name — that
// this key doesn't capture, so it must never be served to a plain fresh request.
function modelsStillMatch(stepRows: readonly RunStepRow[]): boolean {
  const { models } = stepMetaOf(stepRows);
  return StepNameSchema.options.every((step) => models[step] === resolveModel(step));
}
