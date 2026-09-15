import { describe, expect, it } from "vitest";
import { checkGenericOutputRules } from "@/lib/domain/guardrails/genericRules";

describe("checkGenericOutputRules", () => {
  it("flags an empty string field", () => {
    const violations = checkGenericOutputRules({ tagline: "" });
    expect(violations.map((v) => v.rule)).toContain("output.nonempty");
  });

  it("flags an unfilled placeholder", () => {
    const violations = checkGenericOutputRules({ tagline: "The [Brand Name] difference" });
    expect(violations.map((v) => v.rule)).toContain("output.placeholder");
  });

  it("flags a literal 'brand name' placeholder", () => {
    const violations = checkGenericOutputRules({ headline: "Try Brand Name today" });
    expect(violations.map((v) => v.rule)).toContain("output.placeholder");
  });

  it("flags a banned word anywhere in a nested structure", () => {
    const violations = checkGenericOutputRules({
      callouts: ["totally not a scam", "great value"],
    });
    expect(violations.map((v) => v.rule)).toContain("output.banned_word");
  });

  it("passes clean, filled-in copy", () => {
    const violations = checkGenericOutputRules({
      tagline: "Fresh brews, honestly sourced",
      tone_notes: { voice: ["warm", "direct"], avoid: [] },
    });
    expect(violations).toEqual([]);
  });
});
