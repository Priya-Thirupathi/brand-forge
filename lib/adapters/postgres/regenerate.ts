import { z } from "zod";
import type { Pool } from "pg";
import { evaluateCandidates } from "@/lib/domain/guardrails/nameRules";
import type { NamingAccepted } from "@/lib/domain/agents/naming";
import type { CategoryFacts } from "@/lib/domain/types";

export type AlternateNamingResult =
  | { ok: true; naming: NamingAccepted }
  | { ok: false; reason: "unknown_run" | "not_a_candidate" };

// Only `name`/`rationale` are read back: `passed` and `violations` are stored alongside them
// (NameCandidateRecord) but are deliberately ignored here and recomputed below.
const StoredCandidatesSchema = z.array(z.object({ name: z.string(), rationale: z.string() }));

// D30, Stage 5 item 3. Pins an earlier run's naming step to a different one of the candidates
// it already produced, so tagline/description and packaging can be regenerated around that
// name without calling the naming model again.
//
// The client sends a name, but that name is never trusted as text. The candidate set comes
// from the origin run's own `runs.name_candidates`, and the chosen one is re-checked against
// the *current* per-candidate name rules rather than the `passed` flag stored with it — a
// candidate that passed months ago under older rules shouldn't get a free ride into a new
// brand now. A candidate that fails them was dropped for a reason (length, bare category name,
// famous-brand collision) and never reaches the client at all, so refusing it here is what
// stops a crafted request from routing an unvalidated name into the rest of the pipeline —
// exactly the free-text-name path D8 rejected.
//
// Reading `runs.name_candidates` rather than the naming step's `run_steps.raw_output` (the way
// resume.ts reconstructs accepted steps) is what makes regenerates chainable: a regenerated
// run skipped naming, so it has no naming step row, but it does carry the original candidate
// set forward on its own run row. Picking a third name off a regenerated result therefore
// works, instead of 400ing on the second hop.
//
// Unlike loadResumableAccepted, a miss here is fatal rather than a fallback. A resume that
// can't reconstruct anything degrades harmlessly into an ordinary fresh run; a regenerate that
// can't would spend real quota generating a brand around some *other* name than the one the
// user clicked, which is worse than an error.
export async function loadAlternateNaming(
  pool: Pool,
  runId: string,
  alternateName: string,
  category: CategoryFacts,
): Promise<AlternateNamingResult> {
  const { rows } = await pool.query<{ name_candidates: unknown }>(`select name_candidates from runs where id = $1`, [runId]);
  if (rows.length === 0) return { ok: false, reason: "unknown_run" };

  const stored = StoredCandidatesSchema.safeParse(rows[0].name_candidates);
  // Null for a run that never reached naming, `[]` for a brand follow-up (D29) which had no
  // naming step of its own — neither has anything to offer an alternate from.
  if (!stored.success || stored.data.length === 0) return { ok: false, reason: "unknown_run" };

  const candidates = evaluateCandidates(stored.data, category);
  const chosen = candidates.find((candidate) => candidate.passed && candidate.name === alternateName);
  if (!chosen) return { ok: false, reason: "not_a_candidate" };

  // The whole set is carried over, not just the chosen name — buildSucceededOutcome
  // (lib/domain/result.ts) derives `selected` by comparing each candidate to the run's brand
  // name, so handing it the original set with a different selectedName is all it takes for the
  // regenerated result to show the same names with the new one marked.
  return { ok: true, naming: { candidates, selectedName: chosen.name } };
}
