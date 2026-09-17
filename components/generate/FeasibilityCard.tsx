import type { GenerateResult } from "@/lib/contracts/generate";
import { Badge } from "@/components/ui/Badge";

export function FeasibilityCard({ feasibility }: { feasibility: GenerateResult["feasibility"] }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">Feasibility — {feasibility.material}</span>
        <Badge variant="neutral">Illustrative estimate, not a quote</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[13px] tabular-nums sm:grid-cols-4">
        <div>
          <dt className="font-sans text-xs text-muted">Unit cost</dt>
          <dd>
            {feasibility.currency} {feasibility.cost_low}–{feasibility.cost_high}
          </dd>
        </div>
        <div>
          <dt className="font-sans text-xs text-muted">MOQ</dt>
          <dd>{feasibility.moq} units</dd>
        </div>
        <div>
          <dt className="font-sans text-xs text-muted">Lead time</dt>
          <dd>
            {feasibility.lead_time_days_low}–{feasibility.lead_time_days_high} days
          </dd>
        </div>
        <div>
          <dt className="font-sans text-xs text-muted">First-run cash</dt>
          <dd>
            {feasibility.currency} {feasibility.first_run_cost_low}–{feasibility.first_run_cost_high}
          </dd>
        </div>
      </dl>
      <p className="text-muted">{feasibility.assumptions}</p>
    </div>
  );
}
