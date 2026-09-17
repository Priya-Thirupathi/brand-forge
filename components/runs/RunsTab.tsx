"use client";

import { useEffect, useState } from "react";
import type { RunSummary } from "@/lib/contracts/runs";
import { RunsTable } from "./RunsTable";

export function RunsTab() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/runs")
      .then((res) => res.json())
      .then((body: { runs: RunSummary[] }) => setRuns(body.runs))
      .catch(() => setError("Could not load runs."));
  }, []);

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold tracking-tight">Recent runs</h2>
      {error && <p className="text-sm text-danger">{error}</p>}
      {!error && !runs && <p className="text-sm text-muted">Loading…</p>}
      {runs && <RunsTable runs={runs} />}
    </div>
  );
}
