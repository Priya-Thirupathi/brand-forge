import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveModel, tiersAreDistinct } from "@/config/routing";

// D32: these read process.env directly (resolveModel is called per step, per run), so each test
// sets and restores it rather than relying on whatever .env.local happens to hold.
const ORIGINAL = { strong: process.env.MODEL_STRONG, cheap: process.env.MODEL_CHEAP };

beforeEach(() => {
  process.env.MODEL_STRONG = "strong-model";
  process.env.MODEL_CHEAP = "cheap-model";
});

afterEach(() => {
  process.env.MODEL_STRONG = ORIGINAL.strong;
  process.env.MODEL_CHEAP = ORIGINAL.cheap;
});

describe("resolveModel", () => {
  it("uses the committed STEP_TIER map when no override is given", () => {
    expect(resolveModel("naming")).toBe("strong-model");
    expect(resolveModel("packaging")).toBe("strong-model");
  });

  it("applies an override only to the steps it names", () => {
    const override = { naming: "cheap" } as const;
    expect(resolveModel("naming", override)).toBe("cheap-model");
    expect(resolveModel("packaging", override)).toBe("strong-model");
  });
});

describe("tiersAreDistinct", () => {
  it("is false when both tiers resolve to the same model", () => {
    // The Groq/Qwen reality (D26): one model, so a routing experiment would compare it against
    // itself. The CLI refuses on this rather than reporting a meaningless "no regression".
    process.env.MODEL_CHEAP = "strong-model";
    expect(tiersAreDistinct()).toBe(false);
  });

  it("is true when they differ", () => {
    expect(tiersAreDistinct()).toBe(true);
  });
});
