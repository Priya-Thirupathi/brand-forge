import type { Violation } from "@/lib/contracts/violation";
import { REGULATED_CLAIM_PHRASES } from "@/config/regulatedClaims";
import { MATERIAL_VOCABULARY } from "@/config/materialVocabulary";
import { containsWholeTerm, containsNegatedTerm, normalizeForMatching } from "./normalize";
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

// Prefix negators, matched with an optional determiner in between (normalize.ts) — "zero" and
// the determiner tolerance both come from real false positives caught in stored runs: copy
// reading "creates zero plastic waste" and "without the plastic waste" on a paper-wrapped
// snack bar was being flagged as claiming the product is made of plastic.
const MATERIAL_NEGATORS = ["no", "without", "zero", "free of"];

function isNegatedMention(text: string, term: string): boolean {
  // The postfix form ("plastic free", and "plastic-free" once normalized) never takes a
  // determiner, so it stays a plain phrase match.
  return containsWholeTerm(text, `${term} free`) || containsNegatedTerm(text, MATERIAL_NEGATORS, term);
}

// copy.material (TRD.md §7): a plain mention of a material term must be true of this option;
// a negated mention ("X-free") must not name a material this option actually has. Punctuation
// normalization (normalize.ts) already turns "plastic-free" into the two-word phrase
// "plastic free", so no separate hyphenated variant is needed here.
//
// Known limitation: a figurative mention still reads as a claim. Real copy for a cotton t-shirt
// ended "it is a canvas for your family's unique story" and was flagged for naming a material
// the option doesn't have. Nothing short of understanding the sentence separates that from a
// genuine false claim, so it stays — the quality retry is what absorbs it.
export function checkMaterialConsistency(texts: string[], option: FeasibilityOptionFacts): Violation[] {
  const violations: Violation[] = [];
  const trueTerms = new Set(option.materialTerms.map((term) => normalizeForMatching(term)));

  for (const text of texts) {
    for (const term of MATERIAL_VOCABULARY) {
      const isTrueTerm = trueTerms.has(normalizeForMatching(term));
      const negated = isNegatedMention(text, term);

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
