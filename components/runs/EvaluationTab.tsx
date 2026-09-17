"use client";

import { useState } from "react";
import { EvalRunForm } from "./EvalRunForm";
import { EvalSummary } from "./EvalSummary";

export function EvaluationTab() {
  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="mb-1 text-lg font-semibold tracking-tight">Run an eval</h2>
        <p className="mb-3 text-sm text-muted">
          Runs the 20-case fixture against this app over HTTP, same as the CLI. Takes several minutes — this tab keeps
          checking on it while it runs, no need to keep watching.
        </p>
        <EvalRunForm onStarted={() => setRefreshSignal((n) => n + 1)} />
      </div>
      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Eval runs</h2>
        <EvalSummary refreshSignal={refreshSignal} />
      </div>
    </div>
  );
}
