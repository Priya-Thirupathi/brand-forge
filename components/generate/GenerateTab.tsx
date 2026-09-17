"use client";

import { useGeneration } from "@/lib/client/useGeneration";
import { GenerateForm } from "./GenerateForm";
import { StepProgress } from "./StepProgress";
import { ResultCard } from "./ResultCard";
import { FeasibilityCard } from "./FeasibilityCard";
import { GuardrailPanel } from "./GuardrailPanel";
import { RejectionNotice } from "./RejectionNotice";
import { QuotaNotice } from "./QuotaNotice";

export function GenerateTab() {
  const { state, generate, resume, reset } = useGeneration();
  const running = state.status === "running";
  const resumable = state.status === "run_error" && state.step !== "naming";

  return (
    <div className="flex flex-col gap-6">
      <GenerateForm disabled={running} onSubmit={generate} />

      {running && <StepProgress steps={state.steps} />}

      {state.status === "admission_error" && <QuotaNotice message={state.message} retryAfterS={state.retryAfterS} />}
      {state.status === "run_error" && <QuotaNotice message={state.message} code={state.code} />}

      {(state.status === "succeeded" || state.status === "rejected") && (
        <div className="flex flex-col gap-4">
          <FeasibilityCard feasibility={state.result.feasibility} />
          {state.status === "succeeded" && <ResultCard result={state.result} />}
          {state.status === "rejected" && <RejectionNotice result={state.result} />}
          <GuardrailPanel result={state.result} />
          <button type="button" onClick={reset} className="self-start text-sm font-medium text-accent underline underline-offset-4 hover:opacity-80">
            Generate another
          </button>
        </div>
      )}

      {(state.status === "run_error" || state.status === "admission_error") && (
        <div className="flex items-center gap-4">
          {resumable && state.status === "run_error" && (
            <button
              type="button"
              onClick={() => resume(state.runId, state.step)}
              className="self-start rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90"
            >
              Resume from {state.step.replace("_", " ")}
            </button>
          )}
          <button type="button" onClick={reset} className="self-start text-sm font-medium text-accent underline underline-offset-4 hover:opacity-80">
            {resumable ? "Start over instead" : "Try again"}
          </button>
        </div>
      )}
    </div>
  );
}
