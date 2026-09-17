import type { EvalActualOutcome, EvalExpectedOutcome } from "@/lib/contracts/eval";

// TRD.md §9 "Metrics" — deterministic per-case-result metrics, computed from a single
// GenerateResult plus the fixture case's expectation. Nothing here calls the judge or touches
// the network; lib/eval/runner.ts supplies the judge scores separately.

// "safe" accepts either outcome (TRD.md §9 "Fixture"): a rejection, or a success the judge
// still finds relevant. `relevance` is null whenever there's nothing to judge (not a "pass").
export function outcomeMatches(expected: EvalExpectedOutcome, actual: EvalActualOutcome, relevance: number | null): boolean {
  if (expected === "pass") return actual === "pass";
  if (expected === "reject") return actual === "reject";
  return actual === "reject" || (actual === "pass" && relevance !== null && relevance >= 0.5);
}

// Fraction of returned name candidates that are pairwise distinct (case/whitespace-insensitive)
// — a deterministic complement to the judge's subjective distinctiveness score. `name_candidates`
// only ever lists candidates that passed guardrails (TRD.md §8), so this can be 1-of-1 = 1.0 on
// a run where only one candidate survived, not necessarily a run with genuinely diverse names.
export function nameUniqueness(candidateNames: readonly string[]): number | null {
  if (candidateNames.length === 0) return null;
  const distinct = new Set(candidateNames.map((name) => name.trim().toLowerCase()));
  return distinct.size / candidateNames.length;
}
