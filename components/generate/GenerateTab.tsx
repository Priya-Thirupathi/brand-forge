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
          <button type="button" onClick={reset} className="self-start text-sm font-medium underline underline-offset-2">
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
              className="self-start rounded bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Resume from {state.step.replace("_", " ")}
            </button>
          )}
          <button type="button" onClick={reset} className="self-start text-sm font-medium underline underline-offset-2">
            {resumable ? "Start over instead" : "Try again"}
          </button>
        </div>
      )}
    </div>
  );
}
