import { describe, expect, it } from "vitest";
import { bootstrapCI, compareMetric, mean } from "@/lib/eval/stats";

describe("mean", () => {
  it("averages a list of numbers", () => {
    expect(mean([1, 2, 3])).toBe(2);
  });

  it("is 0 for an empty list", () => {
    expect(mean([])).toBe(0);
  });
});

describe("bootstrapCI", () => {
  it("collapses to a point interval for a single case", () => {
    expect(bootstrapCI([0.3])).toEqual({ ciLow: 0.3, ciHigh: 0.3 });
  });

  it("is [0, 0] for no cases", () => {
    expect(bootstrapCI([])).toEqual({ ciLow: 0, ciHigh: 0 });
  });

  it("brackets a constant, non-zero difference away from 0", () => {
    const { ciLow, ciHigh } = bootstrapCI(new Array(20).fill(0.4));
    expect(ciLow).toBeCloseTo(0.4);
    expect(ciHigh).toBeCloseTo(0.4);
  });

  it("widens around 0 for noisy, near-zero differences", () => {
    const diffs = [0.1, -0.1, 0.05, -0.05, 0.02, -0.02, 0.08, -0.08, 0.01, -0.01];
    const { ciLow, ciHigh } = bootstrapCI(diffs);
    expect(ciLow).toBeLessThan(0.05);
    expect(ciHigh).toBeGreaterThan(-0.05);
  });
});

describe("compareMetric", () => {
  it("throws on mismatched or empty paired arrays", () => {
    expect(() => compareMetric([1], [1, 2], { minEffect: 0.05 })).toThrow();
    expect(() => compareMetric([], [], { minEffect: 0.05 })).toThrow();
  });

  it("flags a consistent regression that clears the minimum effect size", () => {
    const baseline = new Array(20).fill(0.8);
    const candidate = new Array(20).fill(0.3);
    const delta = compareMetric(baseline, candidate, { minEffect: 0.05 });
    expect(delta.flagged).toBe(true);
    expect(delta.delta).toBeCloseTo(-0.5);
  });

  it("does not flag a tiny, noisy difference", () => {
    const baseline = [0.8, 0.75, 0.82, 0.79, 0.81, 0.77, 0.83, 0.78];
    const candidate = [0.79, 0.76, 0.81, 0.8, 0.8, 0.78, 0.82, 0.79];
    const delta = compareMetric(baseline, candidate, { minEffect: 0.05 });
    expect(delta.flagged).toBe(false);
  });

  it("uses a relative threshold for latency-shaped metrics", () => {
    const baseline = new Array(20).fill(1000);
    const candidate = new Array(20).fill(1050); // +5%, under a 10% relative threshold
    const delta = compareMetric(baseline, candidate, { minEffect: 0.1, relative: true });
    expect(delta.flagged).toBe(false);
  });
});
