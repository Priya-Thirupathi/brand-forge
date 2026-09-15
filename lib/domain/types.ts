import type { Violation } from "@/lib/contracts/violation";

// Trusted facts an agent's prompt is built from (TRD.md §5 "Prompt construction") — plain
// data, deliberately decoupled from the Postgres row shape so domain code has no reason to
// import an adapter.
export interface CategoryFacts {
  slug: string;
  displayName: string;
  keywords: string[];
}

export interface FeasibilityOptionFacts {
  material: string;
  materialTerms: string[];
  costLow: number;
  costHigh: number;
  currency: string;
  moq: number;
  leadTimeDaysLow: number;
  leadTimeDaysHigh: number;
  assumptions: string;
}

export type Evaluation<Accepted> =
  | { ok: true; accepted: Accepted }
  | { ok: false; violations: Violation[] };
