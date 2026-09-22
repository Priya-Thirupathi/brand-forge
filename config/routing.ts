import type { StepName } from "@/lib/contracts/stepName";
import type { ModelTier } from "@/lib/contracts/eval";

// TRD.md §6 [D12]: step → tier, tier → env model id. Stage 1 routes every step to `strong`;
// Stage 5's strong-vs-cheap experiment (D32) overrides this map per eval run rather than
// editing it, so a tier move is a measured comparison before it is a committed default.
export type { ModelTier };

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

export function resolveModel(step: StepName, tierOverride?: Partial<Record<StepName, ModelTier>>): string {
  const tier = tierOverride?.[step] ?? STEP_TIER[step];
  return process.env[TIER_ENV_VAR[tier]] ?? TIER_DEFAULTS[tier];
}

// D32: whether the two tiers currently resolve to *different* models. On Groq/Qwen they do not
// — D26 sets MODEL_CHEAP to the same id as MODEL_STRONG, because Groq exposes no second tier.
// Running the routing experiment there would compare a model against itself and report "no
// regression flagged", which reads as evidence and is not. Callers use this to refuse.
export function tiersAreDistinct(): boolean {
  return resolveTier("strong") !== resolveTier("cheap");
}

export function resolveTier(tier: ModelTier): string {
  return process.env[TIER_ENV_VAR[tier]] ?? TIER_DEFAULTS[tier];
}
