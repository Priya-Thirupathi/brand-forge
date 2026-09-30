import { describe, expect, it } from "vitest";
import { checkRegulatedClaims, checkMaterialConsistency } from "@/lib/domain/guardrails/copyRules";
import type { FeasibilityOptionFacts } from "@/lib/domain/types";

const steelBottle: FeasibilityOptionFacts = {
  material: "Stainless Steel",
  materialTerms: ["steel", "stainless steel", "metal"],
  costLow: 3.2,
  costHigh: 4.8,
  currency: "USD",
  moq: 500,
  leadTimeDaysLow: 35,
  leadTimeDaysHigh: 50,
  assumptions: "illustrative",
};

// A paper wrapper, matching the snack_bar / tote options in db/seed.sql that produced the real
// false positives this rule's negation handling was widened for.
const paperWrapper: FeasibilityOptionFacts = {
  material: "Recyclable Paper Wrapper",
  materialTerms: ["paper", "paper wrapper", "recyclable paper"],
  costLow: 0.3,
  costHigh: 0.45,
  currency: "USD",
  moq: 5000,
  leadTimeDaysLow: 25,
  leadTimeDaysHigh: 35,
  assumptions: "illustrative",
};

describe("checkRegulatedClaims", () => {
  it("flags a disease-cure claim", () => {
    const violations = checkRegulatedClaims(["This serum cures anxiety instantly."]);
    expect(violations.map((v) => v.rule)).toContain("copy.regulated_claim");
  });

  it("passes ordinary marketing copy", () => {
    const violations = checkRegulatedClaims(["A calming evening ritual for busy people."]);
    expect(violations).toEqual([]);
  });
});

describe("checkMaterialConsistency", () => {
  it("flags claiming a material this option doesn't have", () => {
    const violations = checkMaterialConsistency(["Made from durable plastic."], steelBottle);
    expect(violations.map((v) => v.rule)).toContain("copy.material");
  });

  it("flags falsely claiming to be free of a material the option actually has", () => {
    const violations = checkMaterialConsistency(["100% steel-free design."], steelBottle);
    expect(violations.map((v) => v.rule)).toContain("copy.material");
  });

  it("does not flag a true plastic-free claim on a steel bottle", () => {
    const violations = checkMaterialConsistency(["Proudly plastic-free and built to last."], steelBottle);
    expect(violations).toEqual([]);
  });

  it("passes copy that accurately describes the option's material", () => {
    const violations = checkMaterialConsistency(["Crafted from durable stainless steel."], steelBottle);
    expect(violations).toEqual([]);
  });

  // The next two are verbatim from stored runs that were wrongly rejected: a paper-wrapped
  // snack bar truthfully saying it avoids plastic read as a claim to be made of plastic.
  it("does not flag 'zero X' as a claim to be made of X", () => {
    const violations = checkMaterialConsistency(["The packaging creates zero plastic waste."], paperWrapper);
    expect(violations).toEqual([]);
  });

  it("does not flag a negation with a determiner between it and the material", () => {
    const violations = checkMaterialConsistency(
      ["Ready to fuel your next send without the plastic waste."],
      paperWrapper,
    );
    expect(violations).toEqual([]);
  });

  // The guard that keeps the determiner list narrow: only a determiner may sit between the
  // negator and the term, so "zero waste paper" stays an ordinary (true) mention of paper
  // rather than being read as "this contains no paper".
  it("treats 'zero waste paper' as a plain mention, not a negation", () => {
    const violations = checkMaterialConsistency(["Zero waste paper packaging, start to finish."], paperWrapper);
    expect(violations).toEqual([]);
  });

  it("still catches a false negation reached through a determiner", () => {
    const violations = checkMaterialConsistency(["Built with no more steel than a paper cup."], steelBottle);
    expect(violations.map((v) => v.rule)).toContain("copy.material");
  });

  it("catches a 'zero X' claim when the option actually is X", () => {
    const violations = checkMaterialConsistency(["Zero paper in this build."], paperWrapper);
    expect(violations.map((v) => v.rule)).toContain("copy.material");
  });

  // Accepted limitation (copyRules.ts): a figurative material word is indistinguishable from a
  // claim. This is a real rejected run's copy, kept as a record of the trade-off, not a target.
  it("still flags a metaphorical material word — known limitation", () => {
    const violations = checkMaterialConsistency(
      ["It is a canvas for your family's unique story."],
      steelBottle,
    );
    expect(violations.map((v) => v.rule)).toContain("copy.material");
  });
});
