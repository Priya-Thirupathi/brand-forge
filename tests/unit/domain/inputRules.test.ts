import { describe, expect, it } from "vitest";
import { checkBannedWordInIdea } from "@/lib/domain/guardrails/inputRules";

describe("checkBannedWordInIdea", () => {
  it("passes an idea with no banned words", () => {
    expect(checkBannedWordInIdea("a reusable water bottle for hikers")).toEqual([]);
  });

  it("flags a banned word as input.banned_word", () => {
    const violations = checkBannedWordInIdea("a scam-proof water bottle");
    expect(violations).toEqual([{ rule: "input.banned_word", message: expect.stringContaining("scam") }]);
  });

  it("doesn't flag a word that merely contains a banned term as a substring", () => {
    // "scamper" contains "scam" but isn't the word "scam" — containsWholeTerm is whole-word only.
    expect(checkBannedWordInIdea("a bottle for scampering up mountains")).toEqual([]);
  });
});
