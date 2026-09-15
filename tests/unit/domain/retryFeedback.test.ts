import { describe, expect, it } from "vitest";
import { renderRetryFeedback } from "@/lib/domain/prompts/retryFeedback";

describe("renderRetryFeedback", () => {
  it("renders nothing for an empty violation list", () => {
    expect(renderRetryFeedback([])).toBe("");
  });

  it("lists each violation's rule and message", () => {
    const text = renderRetryFeedback([
      { rule: "name.count", message: "expected exactly 3 candidates, got 1" },
      { rule: "name.distinct", message: "duplicate candidate name" },
    ]);
    expect(text).toContain("name.count: expected exactly 3 candidates, got 1");
    expect(text).toContain("name.distinct: duplicate candidate name");
  });
});
