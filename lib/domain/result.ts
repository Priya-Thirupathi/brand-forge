import type { StepName } from "@/lib/contracts/stepName";
import type { Violation } from "@/lib/contracts/violation";
import type { FeasibilityOptionFacts } from "./types";
import { firstRunCash, type FirstRunCash } from "./feasibility";
import type { TaglineDescriptionOutput } from "./guardrails/taglineDescriptionRules";
import type { PackagingOutput } from "./guardrails/packagingRules";
import type { EvaluatedCandidate } from "./guardrails/nameRules";

export interface NameCandidateResult {
  name: string;
  selected: boolean;
}

// Every field below is content generated for the user. Its presence is gated entirely by
// `status: "succeeded"` at the type level — a RejectedGeneration has none of these fields, so
// there's no field to forget to strip before a rejected/errored result reaches the client
// (PRD M1: generated content reaches the client only when status = succeeded).
export interface SucceededGeneration {
  status: "succeeded";
  feasibility: FeasibilityOptionFacts & { firstRunCash: FirstRunCash };
  brandName: string;
  toneNotes: TaglineDescriptionOutput["tone_notes"];
  tagline: string;
  description: string;
  packaging: PackagingOutput;
  nameCandidates: NameCandidateResult[];
  qualityRetries: number;
}

export interface RejectedGeneration {
  status: "rejected";
  feasibility: FeasibilityOptionFacts & { firstRunCash: FirstRunCash };
  qualityRetries: number;
  failure: { step: StepName | "input"; violations: Violation[] };
}

export type GenerationOutcome = SucceededGeneration | RejectedGeneration;

export function buildSucceededOutcome(params: {
  feasibilityOption: FeasibilityOptionFacts;
  brandName: string;
  toneNotes: TaglineDescriptionOutput["tone_notes"];
  tagline: string;
  description: string;
  packaging: PackagingOutput;
  nameCandidates: EvaluatedCandidate[];
  qualityRetries: number;
}): SucceededGeneration {
  return {
    status: "succeeded",
    feasibility: { ...params.feasibilityOption, firstRunCash: firstRunCash(params.feasibilityOption) },
    brandName: params.brandName,
    toneNotes: params.toneNotes,
    tagline: params.tagline,
    description: params.description,
    packaging: params.packaging,
    // Only passing candidates are returned to the client (TRD.md §5 "Name selection").
    nameCandidates: params.nameCandidates
      .filter((candidate) => candidate.passed)
      .map((candidate) => ({ name: candidate.name, selected: candidate.name === params.brandName })),
    qualityRetries: params.qualityRetries,
  };
}

export function buildRejectedOutcome(params: {
  feasibilityOption: FeasibilityOptionFacts;
  qualityRetries: number;
  step: StepName | "input";
  violations: Violation[];
}): RejectedGeneration {
  return {
    status: "rejected",
    feasibility: { ...params.feasibilityOption, firstRunCash: firstRunCash(params.feasibilityOption) },
    qualityRetries: params.qualityRetries,
    failure: { step: params.step, violations: params.violations },
  };
}
