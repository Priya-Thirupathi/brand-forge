import type { Violation } from "@/lib/contracts/violation";
import { NAME } from "@/config/limits";
import { FAMOUS_BRANDS } from "@/config/famousBrands";
import { normalizeForMatching, containsWholeTerm, countWords } from "./normalize";
import type { CategoryFacts } from "../types";

export interface NamingCandidate {
  name: string;
  rationale: string;
}

export interface EvaluatedCandidate extends NamingCandidate {
  passed: boolean;
  violations: Violation[];
}

// name.count, name.distinct (TRD.md §7) — properties of the whole set of candidates.
export function checkCandidateSetRules(candidates: NamingCandidate[]): Violation[] {
  const violations: Violation[] = [];

  if (candidates.length !== NAME.count) {
    violations.push({
      rule: "name.count",
      message: `expected exactly ${NAME.count} candidates, got ${candidates.length}`,
    });
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = normalizeForMatching(candidate.name);
    if (seen.has(key)) {
      violations.push({ rule: "name.distinct", message: `duplicate candidate name "${candidate.name}"` });
    }
    seen.add(key);
  }

  return violations;
}

// name.shape, name.not_category, name.famous_brand (TRD.md §7) — properties of one candidate.
export function checkCandidateRules(name: string, category: CategoryFacts): Violation[] {
  const violations: Violation[] = [];

  const words = countWords(name);
  const chars = name.trim().length;
  if (words < NAME.words.min || words > NAME.words.max) {
    violations.push({
      rule: "name.shape",
      message: `"${name}" has ${words} words, expected ${NAME.words.min}-${NAME.words.max}`,
    });
  } else if (chars < NAME.chars.min || chars > NAME.chars.max) {
    violations.push({
      rule: "name.shape",
      message: `"${name}" has ${chars} characters, expected ${NAME.chars.min}-${NAME.chars.max}`,
    });
  }

  const nameWords = normalizeForMatching(name).split(" ").filter(Boolean);
  const categoryWords = new Set(
    category.keywords.flatMap((keyword) => normalizeForMatching(keyword).split(" ")),
  );
  if (nameWords.length > 0 && nameWords.every((word) => categoryWords.has(word))) {
    violations.push({ rule: "name.not_category", message: `"${name}" is made only of category keywords` });
  }

  for (const brand of FAMOUS_BRANDS) {
    if (containsWholeTerm(name, brand)) {
      violations.push({ rule: "name.famous_brand", message: `"${name}" contains the famous brand "${brand}"` });
      break;
    }
  }

  return violations;
}

export function evaluateCandidates(
  candidates: NamingCandidate[],
  category: CategoryFacts,
): EvaluatedCandidate[] {
  return candidates.map((candidate) => {
    const violations = checkCandidateRules(candidate.name, category);
    return { ...candidate, passed: violations.length === 0, violations };
  });
}

// name.none_passed (TRD.md §7): at least one candidate must pass its per-candidate rules.
export function checkNonePassedRule(evaluated: EvaluatedCandidate[]): Violation[] {
  return evaluated.some((candidate) => candidate.passed)
    ? []
    : [{ rule: "name.none_passed", message: "no candidate passed the per-candidate rules" }];
}
