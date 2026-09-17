import type { RunSummary } from "@/lib/contracts/runs";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";

const STATUS_VARIANT: Record<RunSummary["status"], BadgeVariant> = {
  running: "info",
  succeeded: "success",
  rejected: "warning",
  error: "danger",
};

// RunSummary.failure is one of two shapes (TRD.md §4/§8): a guardrail rejection names rule
// ids, a transport failure names its reason code — no message, on purpose (see the contract).
function formatFailure(failure: RunSummary["failure"]): string {
  if (!failure) return "—";
  if ("rules" in failure) return `${failure.step}: ${failure.rules.join(", ")}`;
  return `${failure.step}: ${failure.error}`;
}

export function RunsTable({ runs }: { runs: RunSummary[] }) {
  if (runs.length === 0) {
    return <p className="text-sm text-muted">No runs yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th className="px-4 py-2.5 font-medium">Created</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium">Category</th>
            <th className="px-4 py-2.5 font-medium">Resumed from</th>
            <th className="px-4 py-2.5 font-medium">Failure</th>
            <th className="px-4 py-2.5 font-medium">Quality retries</th>
            <th className="px-4 py-2.5 font-medium">Transport retries</th>
            <th className="px-4 py-2.5 font-medium">Latency</th>
          </tr>
        </thead>
        <tbody className="font-mono text-[13px] tabular-nums">
          {runs.map((run) => (
            <tr key={run.id} className="border-t border-line">
              <td className="px-4 py-2">{new Date(run.created_at).toLocaleString()}</td>
              <td className="px-4 py-2">
                <Badge variant={STATUS_VARIANT[run.status]}>{run.status}</Badge>
              </td>
              <td className="px-4 py-2">{run.category}</td>
              <td className="px-4 py-2 text-muted">{run.resumed_from_run_id ? run.resumed_from_run_id.slice(0, 8) : "—"}</td>
              <td className="px-4 py-2">{formatFailure(run.failure)}</td>
              <td className="px-4 py-2">{run.quality_retries}</td>
              <td className="px-4 py-2">{run.transport_retries}</td>
              <td className="px-4 py-2">{run.latency_ms !== null ? `${run.latency_ms} ms` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
