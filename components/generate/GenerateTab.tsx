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
  const { state, generate, reset } = useGeneration();
  const running = state.status === "running";

  return (
    <div className="flex flex-col gap-6">
      <GenerateForm disabled={running} onSubmit={generate} />

      {running && <StepProgress steps={state.steps} />}

      {state.status === "admission_error" && <QuotaNotice message={state.message} retryAfterS={state.retryAfterS} />}
      {state.status === "run_error" && <QuotaNotice message={state.message} />}

      {(state.status === "succeeded" || state.status === "rejected") && (
        <div className="flex flex-col gap-4">
          <FeasibilityCard feasibility={state.result.feasibility} />
          {state.status === "succeeded" && <ResultCard result={state.result} />}
          {state.status === "rejected" && <RejectionNotice result={state.result} />}
          <GuardrailPanel result={state.result} />
          <button type="button" onClick={reset} className="self-start text-sm font-medium underline underline-offset-2">
            Generate another
          </button>
        </div>
      )}

      {(state.status === "run_error" || state.status === "admission_error") && (
        <button type="button" onClick={reset} className="self-start text-sm font-medium underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  );
}
