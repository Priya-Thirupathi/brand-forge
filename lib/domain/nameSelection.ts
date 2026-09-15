import type { EvaluatedCandidate } from "./guardrails/nameRules";

// D8: the first candidate, in the model's own order, that passes all per-candidate rules.
export function selectName(evaluated: EvaluatedCandidate[]): string | null {
  const passing = evaluated.find((candidate) => candidate.passed);
  return passing ? passing.name : null;
}
