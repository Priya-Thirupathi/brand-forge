import type { FeasibilityOptionFacts } from "./types";

export interface FirstRunCash {
  low: number;
  high: number;
}

// TRD.md §3: first-run cash = moq × cost_low … moq × cost_high. Computed on the fly, never
// stored — it's a pure function of feasibility_options that changes if the option's numbers do.
export function firstRunCash(option: Pick<FeasibilityOptionFacts, "moq" | "costLow" | "costHigh">): FirstRunCash {
  return {
    low: round2(option.moq * option.costLow),
    high: round2(option.moq * option.costHigh),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
