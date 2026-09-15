import { describe, expect, it } from "vitest";
import { checkPackagingShapeRules } from "@/lib/domain/guardrails/packagingRules";
import type { PackagingOutput } from "@/lib/domain/guardrails/packagingRules";

const validOutput: PackagingOutput = {
  headline: "Wagwell treats, made honestly",
  body:
    "Wagwell treats are baked in small batches with real, recognizable ingredients — no fillers, no " +
    "mystery meat, just food your dog will actually beg for at the door every single time you reach for the bag.",
  callouts: ["Small-batch baked", "Real ingredients only", "No fillers ever"],
};

describe("checkPackagingShapeRules", () => {
  it("passes a well-formed output", () => {
    expect(checkPackagingShapeRules(validOutput, "Wagwell")).toEqual([]);
  });

  it("flags a headline over the word limit", () => {
    const violations = checkPackagingShapeRules(
      { ...validOutput, headline: "Wagwell treats made with love every single day for dogs" },
      "Wagwell",
    );
    expect(violations.map((v) => v.rule)).toContain("packaging.headline_length");
  });

  it("flags a headline missing the brand name", () => {
    const violations = checkPackagingShapeRules(
      { ...validOutput, headline: "Treats, made honestly", body: validOutput.body.replace("Wagwell", "We") },
      "Wagwell",
    );
    expect(violations.map((v) => v.rule)).toContain("packaging.brand_name");
  });

  it("flags too few callouts", () => {
    const violations = checkPackagingShapeRules({ ...validOutput, callouts: ["One only"] }, "Wagwell");
    expect(violations.map((v) => v.rule)).toContain("packaging.callouts");
  });

  it("flags a callout over the word limit, keeping the count itself valid", () => {
    const violations = checkPackagingShapeRules(
      { ...validOutput, callouts: ["This callout has way too many words in it", "Short one"] },
      "Wagwell",
    );
    expect(violations.map((v) => v.rule)).toContain("packaging.callouts");
  });
});
