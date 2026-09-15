import type { GenerateResult } from "@/lib/contracts/generate";

export function FeasibilityCard({ feasibility }: { feasibility: GenerateResult["feasibility"] }) {
  return (
    <div className="flex flex-col gap-2 rounded border border-zinc-200 p-5 text-sm dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <span className="font-medium">Feasibility — {feasibility.material}</span>
        <span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs dark:bg-zinc-800">Illustrative estimate, not a quote</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt className="text-zinc-500">Unit cost</dt>
        <dd>
          {feasibility.currency} {feasibility.cost_low}–{feasibility.cost_high}
        </dd>
        <dt className="text-zinc-500">MOQ</dt>
        <dd>{feasibility.moq} units</dd>
        <dt className="text-zinc-500">Lead time</dt>
        <dd>
          {feasibility.lead_time_days_low}–{feasibility.lead_time_days_high} days
        </dd>
        <dt className="text-zinc-500">First-run cash</dt>
        <dd>
          {feasibility.currency} {feasibility.first_run_cost_low}–{feasibility.first_run_cost_high}
        </dd>
      </dl>
      <p className="text-zinc-500">{feasibility.assumptions}</p>
    </div>
  );
}
