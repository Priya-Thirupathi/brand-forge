import { describe, expect, it } from "vitest";
import { buildSucceededOutcome, buildRejectedOutcome } from "@/lib/domain/result";
import type { FeasibilityOptionFacts } from "@/lib/domain/types";

const option: FeasibilityOptionFacts = {
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

describe("buildRejectedOutcome", () => {
  it("never carries generated content — only feasibility and failure info", () => {
    const outcome = buildRejectedOutcome({
      feasibilityOption: option,
      qualityRetries: 1,
      step: "naming",
      violations: [{ rule: "name.none_passed", message: "no candidate passed" }],
    });

    expect(outcome.status).toBe("rejected");
    expect(Object.keys(outcome).sort()).toEqual(
      ["failure", "feasibility", "qualityRetries", "status"].sort(),
    );
  });
});

describe("buildSucceededOutcome", () => {
  it("marks the selected name and includes only passing candidates", () => {
    const outcome = buildSucceededOutcome({
      feasibilityOption: option,
      brandName: "Wagwell",
      toneNotes: { voice: ["warm"], audience: "a", personality: "b", avoid: [] },
      tagline: "t",
      description: "d",
      packaging: { headline: "h", body: "b", callouts: ["c1", "c2"] },
      nameCandidates: [
        { name: "Pet Treats", rationale: "r", passed: false, violations: [] },
        { name: "Wagwell", rationale: "r", passed: true, violations: [] },
        { name: "Barkline", rationale: "r", passed: true, violations: [] },
      ],
      qualityRetries: 0,
    });

    expect(outcome.status).toBe("succeeded");
    expect(outcome.nameCandidates).toEqual([
      { name: "Wagwell", selected: true },
      { name: "Barkline", selected: false },
    ]);
    expect(outcome.feasibility.firstRunCash).toEqual({ low: 1600, high: 2400 });
  });
});
