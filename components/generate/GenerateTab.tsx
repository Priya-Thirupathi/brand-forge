"use client";

import { useGeneration } from "@/lib/client/useGeneration";
import { GenerateForm } from "./GenerateForm";
import { StepProgress } from "./StepProgress";
import { ResultCard } from "./ResultCard";
import { FeasibilityCard } from "./FeasibilityCard";
import { GuardrailPanel } from "./GuardrailPanel";
import { RejectionNotice } from "./RejectionNotice";
import { QuotaNotice } from "./QuotaNotice";
import { Badge } from "@/components/ui/Badge";

// Stage 5, item 2 (D29): the brand a "Add another product" click in the Gallery is targeting.
// Owned here (not in Tabs.tsx, which renders this component) so Tabs → GenerateTab stays a
// one-directional import, not a cycle.
export interface FollowUpTarget {
  brandId: string;
  brandName: string;
}

interface GenerateTabProps {
  followUpTarget: FollowUpTarget | null;
  onClearFollowUpTarget: () => void;
}

export function GenerateTab({ followUpTarget, onClearFollowUpTarget }: GenerateTabProps) {
  const { state, generate, resume, regenerate, watchReplay, reset } = useGeneration();
  const running = state.status === "running";
  const resumable = state.status === "run_error" && state.step !== "naming";
  // Stage 5, item 1: offered specifically when the *quota* is the problem — not a per-IP
  // throttle (rate_limited) or a transient run failure (deadline_exceeded/provider_error/
  // internal/aborted), where an ordinary retry is the right call and already offered below.
  const replayOffered =
    (state.status === "admission_error" && state.error === "daily_cap_reached") || (state.status === "run_error" && state.code === "quota_exhausted");

  return (
    <div className="flex flex-col gap-6">
      <GenerateForm disabled={running} onSubmit={generate} followUpTarget={followUpTarget} onClearFollowUpTarget={onClearFollowUpTarget} />

      {running && state.isReplay && <Badge variant="info">Replaying a recorded run — not live</Badge>}
      {running && <StepProgress steps={state.steps} />}

      {state.status === "admission_error" && <QuotaNotice message={state.message} retryAfterS={state.retryAfterS} />}
      {state.status === "run_error" && <QuotaNotice message={state.message} code={state.code} />}

      {(state.status === "succeeded" || state.status === "rejected") && (
        <div className="flex flex-col gap-4">
          {state.isReplay && <Badge variant="info">Recorded run, replayed with its original timing — not a live generation</Badge>}
          <FeasibilityCard feasibility={state.result.feasibility} />
          {state.status === "succeeded" && (
            <ResultCard
              result={state.result}
              // D30: not offered on a replay — a recorded run is shown precisely because the
              // quota is gone, so a regenerate button there would only ever 429.
              onRegenerate={state.isReplay ? undefined : (name) => regenerate(state.result.run_id, name)}
            />
          )}
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
          {replayOffered && (
            <button
              type="button"
              onClick={watchReplay}
              className="self-start rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90"
            >
              Watch a recorded run instead
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
