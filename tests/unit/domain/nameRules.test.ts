import { describe, expect, it } from "vitest";
import {
  checkCandidateSetRules,
  checkCandidateRules,
  evaluateCandidates,
  checkNonePassedRule,
} from "@/lib/domain/guardrails/nameRules";
import { selectName } from "@/lib/domain/nameSelection";
import type { CategoryFacts } from "@/lib/domain/types";

const petTreatsCategory: CategoryFacts = {
  slug: "pet_treats",
  displayName: "Pet Treats",
  keywords: ["pet treat", "pet treats", "treat", "treats", "dog treat", "dog treats"],
};

describe("checkCandidateSetRules", () => {
  it("requires exactly 3 candidates", () => {
    const violations = checkCandidateSetRules([{ name: "Alpha", rationale: "r" }]);
    expect(violations.map((v) => v.rule)).toContain("name.count");
  });

  it("flags case-insensitive duplicates", () => {
    const violations = checkCandidateSetRules([
      { name: "Alpha", rationale: "r" },
      { name: "alpha", rationale: "r" },
      { name: "Beta", rationale: "r" },
    ]);
    expect(violations.map((v) => v.rule)).toContain("name.distinct");
  });

  it("passes 3 distinct candidates", () => {
    const violations = checkCandidateSetRules([
      { name: "Alpha", rationale: "r" },
      { name: "Beta", rationale: "r" },
      { name: "Gamma", rationale: "r" },
    ]);
    expect(violations).toEqual([]);
  });
});

describe("checkCandidateRules", () => {
  it("flags a name outside the word/char bounds", () => {
    const violations = checkCandidateRules("A", petTreatsCategory);
    expect(violations.map((v) => v.rule)).toContain("name.shape");
  });

  it("flags a name made only of category keywords", () => {
    const violations = checkCandidateRules("Pet Treats", petTreatsCategory);
    expect(violations.map((v) => v.rule)).toContain("name.not_category");
  });

  it("does not flag a name that merely mentions a category word alongside others", () => {
    const violations = checkCandidateRules("Wagwell Treats", petTreatsCategory);
    expect(violations.map((v) => v.rule)).not.toContain("name.not_category");
  });

  it("flags a famous brand", () => {
    const violations = checkCandidateRules("Purina Plus", petTreatsCategory);
    expect(violations.map((v) => v.rule)).toContain("name.famous_brand");
  });

  it("passes a plausible original name", () => {
    const violations = checkCandidateRules("Wagwell", petTreatsCategory);
    expect(violations).toEqual([]);
  });
});

describe("evaluateCandidates + selectName + checkNonePassedRule", () => {
  it("selects the first passing candidate in model order", () => {
    const evaluated = evaluateCandidates(
      [
        { name: "Pet Treats", rationale: "r" }, // fails name.not_category
        { name: "Wagwell", rationale: "r" }, // passes
        { name: "Barkline", rationale: "r" }, // passes
      ],
      petTreatsCategory,
    );
    expect(selectName(evaluated)).toBe("Wagwell");
    expect(checkNonePassedRule(evaluated)).toEqual([]);
  });

  it("flags name.none_passed when every candidate fails", () => {
    const evaluated = evaluateCandidates(
      [
        { name: "Pet Treats", rationale: "r" },
        { name: "Treats", rationale: "r" },
        { name: "Dog Treats", rationale: "r" },
      ],
      petTreatsCategory,
    );
    expect(selectName(evaluated)).toBeNull();
    expect(checkNonePassedRule(evaluated).map((v) => v.rule)).toContain("name.none_passed");
  });
});
