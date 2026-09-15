import { describe, expect, it } from "vitest";
import { firstRunCash } from "@/lib/domain/feasibility";

describe("firstRunCash", () => {
  it("multiplies MOQ by the cost range", () => {
    expect(firstRunCash({ moq: 500, costLow: 3.2, costHigh: 4.8 })).toEqual({ low: 1600, high: 2400 });
  });

  it("rounds to 2 decimal places", () => {
    expect(firstRunCash({ moq: 3, costLow: 0.1, costHigh: 0.2 })).toEqual({ low: 0.3, high: 0.6 });
  });
});
