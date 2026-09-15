import type { z } from "zod";
import type { StepName } from "@/lib/contracts/stepName";
import type { Evaluation } from "../types";

export type { Evaluation };

export interface PromptTemplate {
  // {{placeholders}} rendered by lib/domain/prompts/render.ts. `system` always ends with a
  // {{retry_feedback}} placeholder, filled with "" on the first attempt and with a rendered
  // list of failed rules on the quality retry (D11) — that value is supplied by the service
  // layer's generic step runner, not by toVariables, since it depends on the previous
  // attempt's evaluation.
  system: string;
  user: string;
}

export interface AgentSpec<Input, Output, Accepted> {
  step: StepName;
  outputSchema: z.ZodType<Output>;
  promptVersion: string;
  prompt: PromptTemplate;
  toVariables(input: Input): Record<string, string>;
  evaluate(output: Output, input: Input): Evaluation<Accepted>;
}
