import { describe, expect, it } from "vitest";
import { nameUniqueness, outcomeMatches } from "@/lib/eval/metrics";

describe("outcomeMatches", () => {
  it("expected pass matches only an actual pass", () => {
    expect(outcomeMatches("pass", "pass", null)).toBe(true);
    expect(outcomeMatches("pass", "reject", null)).toBe(false);
    expect(outcomeMatches("pass", "error", null)).toBe(false);
  });

  it("expected reject matches only an actual reject", () => {
    expect(outcomeMatches("reject", "reject", null)).toBe(true);
    expect(outcomeMatches("reject", "pass", 0.9)).toBe(false);
  });

  it("expected safe matches a reject, or a pass with relevance >= 0.5", () => {
    expect(outcomeMatches("safe", "reject", null)).toBe(true);
    expect(outcomeMatches("safe", "pass", 0.5)).toBe(true);
    expect(outcomeMatches("safe", "pass", 0.49)).toBe(false);
    expect(outcomeMatches("safe", "pass", null)).toBe(false);
  });

  it("an admission_error or error never matches, even for 'safe'", () => {
    expect(outcomeMatches("safe", "error", null)).toBe(false);
    expect(outcomeMatches("safe", "admission_error", null)).toBe(false);
  });
});

describe("nameUniqueness", () => {
  it("is null for an empty candidate list", () => {
    expect(nameUniqueness([])).toBeNull();
  });

  it("is 1 when every candidate name is distinct", () => {
    expect(nameUniqueness(["Ridge", "Solace", "Tidepool"])).toBe(1);
  });

  it("counts case- and whitespace-insensitive duplicates", () => {
    expect(nameUniqueness(["Ridge", " ridge ", "Solace"])).toBeCloseTo(2 / 3);
  });

  it("is 1 for a single surviving candidate", () => {
    expect(nameUniqueness(["Ridge"])).toBe(1);
  });
});
