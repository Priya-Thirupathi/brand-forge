import type { Violation } from "@/lib/contracts/violation";
import { REGULATED_CLAIM_PHRASES } from "@/config/regulatedClaims";
import { MATERIAL_VOCABULARY } from "@/config/materialVocabulary";
import { containsWholeTerm, normalizeForMatching } from "./normalize";
import type { FeasibilityOptionFacts } from "../types";

// copy.regulated_claim (TRD.md §7) — applies to tagline_description and packaging alike.
export function checkRegulatedClaims(texts: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const text of texts) {
    for (const phrase of REGULATED_CLAIM_PHRASES) {
      if (containsWholeTerm(text, phrase)) {
        violations.push({
          rule: "copy.regulated_claim",
          message: `contains the regulated claim phrase "${phrase}"`,
        });
      }
    }
  }
  return violations;
}

function negationPhrasesFor(term: string): string[] {
  return [`${term} free`, `no ${term}`, `without ${term}`, `free of ${term}`];
}

// copy.material (TRD.md §7): a plain mention of a material term must be true of this option;
// a negated mention ("X-free") must not name a material this option actually has. Punctuation
// normalization (normalize.ts) already turns "plastic-free" into the two-word phrase
// "plastic free", so no separate hyphenated variant is needed here.
export function checkMaterialConsistency(texts: string[], option: FeasibilityOptionFacts): Violation[] {
  const violations: Violation[] = [];
  const trueTerms = new Set(option.materialTerms.map((term) => normalizeForMatching(term)));

  for (const text of texts) {
    for (const term of MATERIAL_VOCABULARY) {
      const isTrueTerm = trueTerms.has(normalizeForMatching(term));
      const negated = negationPhrasesFor(term).some((phrase) => containsWholeTerm(text, phrase));

      if (negated) {
        if (isTrueTerm) {
          violations.push({
            rule: "copy.material",
            message: `claims "${term}-free" but this option's materials include "${term}"`,
          });
        }
        continue;
      }

      if (containsWholeTerm(text, term) && !isTrueTerm) {
        violations.push({
          rule: "copy.material",
          message: `mentions "${term}" which isn't one of this option's materials`,
        });
      }
    }
  }

  return violations;
}
