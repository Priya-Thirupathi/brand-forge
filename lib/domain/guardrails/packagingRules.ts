import type { Violation } from "@/lib/contracts/violation";
import { PACKAGING } from "@/config/limits";
import { countWords, containsWholeTerm } from "./normalize";

export interface PackagingOutput {
  headline: string;
  body: string;
  callouts: string[];
}

// packaging.headline_length, packaging.body_length, packaging.callouts, packaging.brand_name
// (TRD.md §7).
export function checkPackagingShapeRules(output: PackagingOutput, brandName: string): Violation[] {
  const violations: Violation[] = [];

  if (countWords(output.headline) > PACKAGING.headlineMaxWords) {
    violations.push({
      rule: "packaging.headline_length",
      message: `headline exceeds ${PACKAGING.headlineMaxWords} words`,
    });
  }

  const bodyWords = countWords(output.body);
  if (bodyWords < PACKAGING.bodyWords.min || bodyWords > PACKAGING.bodyWords.max) {
    violations.push({
      rule: "packaging.body_length",
      message: `body has ${bodyWords} words, expected ${PACKAGING.bodyWords.min}-${PACKAGING.bodyWords.max}`,
    });
  }

  if (output.callouts.length < PACKAGING.callouts.min || output.callouts.length > PACKAGING.callouts.max) {
    violations.push({
      rule: "packaging.callouts",
      message: `expected ${PACKAGING.callouts.min}-${PACKAGING.callouts.max} callouts, got ${output.callouts.length}`,
    });
  } else {
    for (const callout of output.callouts) {
      if (countWords(callout) > PACKAGING.calloutMaxWords) {
        violations.push({
          rule: "packaging.callouts",
          message: `callout "${callout}" exceeds ${PACKAGING.calloutMaxWords} words`,
        });
      }
    }
  }

  const mentionsBrand =
    containsWholeTerm(output.headline, brandName) || containsWholeTerm(output.body, brandName);
  if (!mentionsBrand) {
    violations.push({ rule: "packaging.brand_name", message: "brand name doesn't appear in headline or body" });
  }

  return violations;
}
