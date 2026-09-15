import type { RunSummary } from "@/lib/contracts/runs";

const STATUS_STYLES: Record<RunSummary["status"], string> = {
  running: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  succeeded: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  rejected: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  error: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function RunsTable({ runs }: { runs: RunSummary[] }) {
  if (runs.length === 0) {
    return <p className="text-sm text-zinc-500">No runs yet.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead className="text-zinc-500">
        <tr>
          <th className="py-1.5 pr-4 font-medium">Created</th>
          <th className="py-1.5 pr-4 font-medium">Status</th>
          <th className="py-1.5 pr-4 font-medium">Category</th>
          <th className="py-1.5 pr-4 font-medium">Quality retries</th>
          <th className="py-1.5 pr-4 font-medium">Transport retries</th>
          <th className="py-1.5 pr-4 font-medium">Latency</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id} className="border-t border-zinc-200 dark:border-zinc-800">
            <td className="py-1.5 pr-4">{new Date(run.created_at).toLocaleString()}</td>
            <td className="py-1.5 pr-4">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[run.status]}`}>{run.status}</span>
            </td>
            <td className="py-1.5 pr-4">{run.category}</td>
            <td className="py-1.5 pr-4">{run.quality_retries}</td>
            <td className="py-1.5 pr-4">{run.transport_retries}</td>
            <td className="py-1.5 pr-4">{run.latency_ms !== null ? `${run.latency_ms} ms` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
