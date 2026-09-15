import type { StepName } from "@/lib/contracts/stepName";
import { STEP_NAMES, type StepState } from "@/lib/client/generationReducer";

const STEP_LABELS: Record<StepName, string> = {
  naming: "Naming",
  tagline_description: "Tagline & description",
  packaging: "Packaging",
};

const STATE_STYLES: Record<StepState, string> = {
  pending: "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  retrying: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  passed: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
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
    <ol className="flex flex-col gap-2">
      {STEP_NAMES.map((step) => (
        <li key={step} className="flex items-center gap-3 text-sm">
          <span className={`rounded-full px-2.5 py-0.5 font-medium ${STATE_STYLES[steps[step]]}`}>{STATE_LABELS[steps[step]]}</span>
          <span>{STEP_LABELS[step]}</span>
        </li>
      ))}
    </ol>
  );
}
