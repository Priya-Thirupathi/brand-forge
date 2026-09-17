import type { StepName } from "@/lib/contracts/stepName";
import { STEP_NAMES, type StepState } from "@/lib/client/generationReducer";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";

const STEP_LABELS: Record<StepName, string> = {
  naming: "Naming",
  tagline_description: "Tagline & description",
  packaging: "Packaging",
};

const STATE_VARIANT: Record<StepState, BadgeVariant> = {
  pending: "neutral",
  in_progress: "info",
  retrying: "warning",
  passed: "success",
  failed: "danger",
};

const STATE_LABELS: Record<StepState, string> = {
  pending: "Pending",
  in_progress: "Running",
  retrying: "Retrying",
  passed: "Passed",
  failed: "Failed",
};

export function StepProgress({ steps }: { steps: Record<StepName, StepState> }) {
  return (
    <ol className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-5">
      {STEP_NAMES.map((step) => (
        <li key={step} className="flex items-center gap-3 text-sm">
          <Badge variant={STATE_VARIANT[steps[step]]}>{STATE_LABELS[steps[step]]}</Badge>
          <span className={steps[step] === "pending" ? "text-muted" : ""}>{STEP_LABELS[step]}</span>
        </li>
      ))}
    </ol>
  );
}
