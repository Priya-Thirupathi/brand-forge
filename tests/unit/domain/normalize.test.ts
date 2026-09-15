import { describe, expect, it } from "vitest";
import { normalizeForMatching, containsWholeTerm, countWords } from "@/lib/domain/guardrails/normalize";

describe("normalizeForMatching", () => {
  it("lowercases and applies NFKC", () => {
    expect(normalizeForMatching("Café")).toBe("cafe");
  });

  it("turns punctuation and hyphens into word boundaries", () => {
    expect(normalizeForMatching("plastic-free")).toBe("plastic free");
  });
});

describe("containsWholeTerm", () => {
  it("matches a whole single-word term", () => {
    expect(containsWholeTerm("this can is classic", "can")).toBe(true);
  });

  it("does not match a term as a substring of another word (classic vs class)", () => {
    expect(containsWholeTerm("this is a classic design", "class")).toBe(false);
  });

  it("matches a multi-word phrase across normalized boundaries", () => {
    expect(containsWholeTerm("made with recycled aluminum", "recycled aluminum")).toBe(true);
  });

  it("matches a hyphenated phrase the same as its spaced form", () => {
    expect(containsWholeTerm("this bottle is plastic-free", "plastic free")).toBe(true);
  });
});

describe("countWords", () => {
  it("counts words separated by whitespace", () => {
    expect(countWords("  a short   phrase  ")).toBe(3);
  });

  it("returns 0 for an empty string", () => {
    expect(countWords("   ")).toBe(0);
  });
});
