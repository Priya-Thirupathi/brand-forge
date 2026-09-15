import type { StepName } from "@/lib/contracts/stepName";

// TRD.md §6 [D12]: step → tier, tier → env model id. Stage 1 routes every step to `strong`;
// Stage 5's strong-vs-cheap experiment only changes the STEP_TIER map, not this shape.
export type ModelTier = "strong" | "cheap";

export const STEP_TIER: Record<StepName, ModelTier> = {
  naming: "strong",
  tagline_description: "strong",
  packaging: "strong",
};

// Matches scripts/check-models.ts's fallback defaults and TRD.md §12.
const TIER_DEFAULTS: Record<ModelTier, string> = {
  strong: "gemini-3.8-flash",
  cheap: "gemini-3.5-flash-lite",
};

const TIER_ENV_VAR: Record<ModelTier, string> = {
  strong: "MODEL_STRONG",
  cheap: "MODEL_CHEAP",
};

export function resolveModel(step: StepName): string {
  const tier = STEP_TIER[step];
  return process.env[TIER_ENV_VAR[tier]] ?? TIER_DEFAULTS[tier];
}
