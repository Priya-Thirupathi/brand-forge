"use client";

import { useEffect, useState } from "react";
import type { EvalRunSummary } from "@/lib/contracts/eval";

function formatPct(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(0)}%`;
}

function formatScore(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

// TRD.md §9 sensitivity proof: a comparison row is only meaningful once at least one metric's
// CI has been checked against the baseline — `flagged` on any metric is a real signal, worth
// calling out rather than burying in the raw delta numbers.
function ComparisonBadges({ comparison }: { comparison: EvalRunSummary["comparison"] }) {
  if (!comparison) return null;
  const flagged = Object.entries(comparison).filter(([key, value]) => key !== "baseline_eval_run_id" && typeof value === "object" && "flagged" in value && value.flagged);
  if (flagged.length === 0) {
    return <span className="text-xs text-zinc-500">vs. baseline: no flagged changes</span>;
  }
  return (
    <span className="text-xs text-amber-700 dark:text-amber-400">
      vs. baseline: flagged {flagged.map(([name]) => name.replace(/_/g, " ")).join(", ")}
    </span>
  );
}

export function EvalSummary() {
  const [runs, setRuns] = useState<EvalRunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/eval/summary")
      .then((res) => res.json())
      .then((body: { runs: EvalRunSummary[] }) => setRuns(body.runs))
      .catch(() => setError("Could not load eval runs."));
  }, []);

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!runs) return <p className="text-sm text-zinc-500">Loading…</p>;
  if (runs.length === 0) {
    return <p className="text-sm text-zinc-500">No eval runs yet — see README.md for `npm run eval -- generate`.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead className="text-zinc-500">
        <tr>
          <th className="py-1.5 pr-4 font-medium">Label</th>
          <th className="py-1.5 pr-4 font-medium">Created</th>
          <th className="py-1.5 pr-4 font-medium">Outcome match</th>
          <th className="py-1.5 pr-4 font-medium">Relevance</th>
          <th className="py-1.5 pr-4 font-medium">Distinctiveness</th>
          <th className="py-1.5 pr-4 font-medium">Latency p50</th>
          <th className="py-1.5 pr-4 font-medium">Comparison</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id} className="border-t border-zinc-200 dark:border-zinc-800">
            <td className="py-1.5 pr-4">
              {run.label}
              {run.is_baseline && <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">baseline</span>}
              {!run.finished_at && <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">in progress</span>}
            </td>
            <td className="py-1.5 pr-4">{new Date(run.created_at).toLocaleString()}</td>
            <td className="py-1.5 pr-4">{formatPct(run.aggregate?.outcome_match_rate ?? null)}</td>
            <td className="py-1.5 pr-4">{formatScore(run.aggregate?.mean_relevance ?? null)}</td>
            <td className="py-1.5 pr-4">{formatScore(run.aggregate?.mean_distinctiveness ?? null)}</td>
            <td className="py-1.5 pr-4">{run.aggregate?.latency_ms_p50 ? `${run.aggregate.latency_ms_p50}ms` : "—"}</td>
            <td className="py-1.5 pr-4">
              <ComparisonBadges comparison={run.comparison} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
