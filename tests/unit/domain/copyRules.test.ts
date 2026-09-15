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
});
