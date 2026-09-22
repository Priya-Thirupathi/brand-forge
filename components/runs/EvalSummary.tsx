"use client";

import { useCallback, useEffect, useState } from "react";
import type { EvalRunSummary } from "@/lib/contracts/eval";
import { Badge } from "@/components/ui/Badge";

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
  // `tone_fit` is nullable (D31), so a null member has to be skipped before the `in` check.
  const flagged = Object.entries(comparison).filter(
    ([key, value]) => key !== "baseline_eval_run_id" && value !== null && typeof value === "object" && "flagged" in value && value.flagged,
  );
  if (flagged.length === 0) {
    return <span className="text-xs text-muted">vs. baseline: no flagged changes</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-warning">
      vs. baseline: flagged {flagged.map(([name]) => name.replace(/_/g, " ")).join(", ")}
    </span>
  );
}

// While a run is in flight, aggregate/comparison are both still null (TRD.md §4) — the only
// thing to show is a live count of case × repeat rows recorded so far, so a 20-minute run
// gives some feedback instead of a static badge the whole time.
const POLL_MS = 8_000;

export function EvalSummary({ refreshSignal }: { refreshSignal?: number }) {
  const [runs, setRuns] = useState<EvalRunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/eval/summary")
      .then((res) => res.json())
      .then((body: { runs: EvalRunSummary[] }) => setRuns(body.runs))
      .catch(() => setError("Could not load eval runs."));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  useEffect(() => {
    const anyInProgress = runs?.some((run) => !run.finished_at) ?? false;
    if (!anyInProgress) return;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [runs, load]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!runs) return <p className="text-sm text-muted">Loading…</p>;
  if (runs.length === 0) {
    return <p className="text-sm text-muted">No eval runs yet — start one above, or run `npm run eval -- generate` from a terminal.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th className="px-4 py-2.5 font-medium">Label</th>
            <th className="px-4 py-2.5 font-medium">Created</th>
            <th className="px-4 py-2.5 font-medium">Outcome match</th>
            <th className="px-4 py-2.5 font-medium">Relevance</th>
            <th className="px-4 py-2.5 font-medium">Distinctiveness</th>
            <th className="px-4 py-2.5 font-medium">Tone fit</th>
            <th className="px-4 py-2.5 font-medium">Latency p50</th>
            <th className="px-4 py-2.5 font-medium">Comparison</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-t border-line">
              <td className="px-4 py-2.5">
                <span className="inline-flex items-center gap-2">
                  {run.label}
                  {run.is_baseline && <Badge variant="neutral">baseline</Badge>}
                  {!run.finished_at && <Badge variant="info">{run.completed_case_repeats} so far…</Badge>}
                </span>
              </td>
              <td className="px-4 py-2.5 font-mono text-[13px] text-muted">{new Date(run.created_at).toLocaleString()}</td>
              <td className="px-4 py-2.5 font-mono text-[13px] tabular-nums">{formatPct(run.aggregate?.outcome_match_rate ?? null)}</td>
              <td className="px-4 py-2.5 font-mono text-[13px] tabular-nums">{formatScore(run.aggregate?.mean_relevance ?? null)}</td>
              <td className="px-4 py-2.5 font-mono text-[13px] tabular-nums">{formatScore(run.aggregate?.mean_distinctiveness ?? null)}</td>
              {/* D31: "—" here means the run predates consistency cases, not that it scored zero. */}
              <td className="px-4 py-2.5 font-mono text-[13px] tabular-nums">{formatScore(run.aggregate?.mean_tone_fit ?? null)}</td>
              <td className="px-4 py-2.5 font-mono text-[13px] tabular-nums">{run.aggregate?.latency_ms_p50 ? `${run.aggregate.latency_ms_p50}ms` : "—"}</td>
              <td className="px-4 py-2.5">
                <ComparisonBadges comparison={run.comparison} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
