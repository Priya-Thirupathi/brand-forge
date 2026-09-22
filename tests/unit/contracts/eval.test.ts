import { describe, expect, it } from "vitest";
import { parseEvalModelTiers, parseEvalPromptVariant } from "@/lib/contracts/eval";

describe("parseEvalPromptVariant", () => {
  it("accepts the one variant that exists and rejects everything else", () => {
    expect(parseEvalPromptVariant("naming=degraded")).toEqual({ step: "naming", variant: "degraded" });
    expect(parseEvalPromptVariant("naming=improved")).toBeNull();
    expect(parseEvalPromptVariant("packaging=degraded")).toBeNull();
  });
});

describe("parseEvalModelTiers (D32)", () => {
  it("parses one or more step=tier pairs", () => {
    expect(parseEvalModelTiers("naming=cheap")).toEqual({ naming: "cheap" });
    expect(parseEvalModelTiers("naming=cheap,packaging=strong")).toEqual({ naming: "cheap", packaging: "strong" });
    expect(parseEvalModelTiers(" naming=cheap , packaging=cheap ")).toEqual({ naming: "cheap", packaging: "cheap" });
  });

  it("returns null for anything it does not recognise, rather than partially applying it", () => {
    // A partially-applied override would silently run some steps on committed routing while the
    // stored comparison claimed the whole experiment had been applied.
    expect(parseEvalModelTiers("naming=medium")).toBeNull();
    expect(parseEvalModelTiers("nameing=cheap")).toBeNull();
    expect(parseEvalModelTiers("naming=cheap,bogus=cheap")).toBeNull();
    expect(parseEvalModelTiers("naming")).toBeNull();
    expect(parseEvalModelTiers("")).toBeNull();
  });
});
