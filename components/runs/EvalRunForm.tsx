"use client";

import { useEffect, useRef, useState } from "react";

interface EvalRunFormProps {
  onStarted: () => void;
}

interface EvalRunChunkResponse {
  eval_run_id: string;
  status: "in_progress" | "completed";
  cases_done: number;
  cases_total: number;
  retry_after_ms?: number;
}

// A minimum poll gap, independent of the server's retry_after_ms — rpm pacing already governs
// the real LLM-call rate (persisted across chunks server-side, see DECISIONS.md D3), so this
// just keeps the browser from hammering the route with back-to-back requests once a case is
// already in flight or the deadline check returns immediately.
const MIN_POLL_MS = 1_000;

// TRD.md §8 / DECISIONS.md D3: authenticated the same way eval-sourced generations already
// are — EVAL_TOKEN isn't stored anywhere by this form, just held in component state for the
// one request, since there's no account system to remember it against (TRD.md §15).
export function EvalRunForm({ onStarted }: EvalRunFormProps) {
  const [label, setLabel] = useState("");
  const [repeats, setRepeats] = useState(1);
  // Defaults to 1, not the server's EVAL_TARGET_RPM fallback of 6 — a run triggered from this
  // form at rpm=6 against local Qwen/Groq blew through its ~1000 output-tokens/minute budget
  // and tanked outcome_match_rate to 30% (vs. 95% at rpm=1) without any prompt regression.
  const [rpm, setRpm] = useState(1);
  const [promptVariant, setPromptVariant] = useState("");
  const [setBaseline, setSetBaseline] = useState(false);
  const [evalToken, setEvalToken] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ evalRunId: string; done: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  // D3's chunked-run fix: each POST only advances the run by about one case, so this tab has to
  // keep re-calling with resume_eval_run_id until the server says "completed" — there's no
  // background task doing that for us anymore (see DECISIONS.md D3). Closing this tab or
  // navigating away stops the run; a later "Start eval run" submission with the same label
  // won't resume it (that needs the CLI's --resume), but the run's completed cases stay recorded.
  //
  // The effect resets cancelledRef on setup, not just on cleanup: React (in dev) mounts every
  // component twice to catch missing cleanup, which runs this effect's cleanup — setting
  // cancelledRef.current = true — before the second, real setup. Without resetting it back to
  // false here, the loop below would silently never iterate past its first chunk in dev.
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  async function runChunk(evalRunId?: string): Promise<EvalRunChunkResponse> {
    const response = await fetch("/api/eval/run", {
      method: "POST",
      headers: { "content-type": "application/json", "x-eval-token": evalToken },
      body: JSON.stringify({
        label: evalRunId ? undefined : label,
        repeats,
        rpm,
        prompt_variant: promptVariant || undefined,
        set_baseline: setBaseline,
        resume_eval_run_id: evalRunId,
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.message ?? "Could not run the eval.");
    }
    return body as EvalRunChunkResponse;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setRunning(true);
    setMessage(null);
    setProgress(null);
    try {
      let result = await runChunk();
      onStarted();
      while (!cancelledRef.current && result.status !== "completed") {
        setProgress({ evalRunId: result.eval_run_id, done: result.cases_done, total: result.cases_total });
        await new Promise((resolve) => setTimeout(resolve, Math.max(MIN_POLL_MS, result.retry_after_ms ?? 0)));
        if (cancelledRef.current) return;
        result = await runChunk(result.eval_run_id);
      }
      if (cancelledRef.current) return;
      setProgress({ evalRunId: result.eval_run_id, done: result.cases_done, total: result.cases_total });
      setMessage({ kind: "success", text: `Eval run ${result.eval_run_id.slice(0, 8)} finished — see it below.` });
      onStarted();
    } catch (error) {
      if (!cancelledRef.current) {
        setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not reach the server." });
      }
    } finally {
      if (!cancelledRef.current) setRunning(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6">
      <div className="flex flex-col gap-4 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium">Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            placeholder="e.g. naming-degraded-check"
            className="rounded-lg border border-line bg-bg px-3 py-2 outline-none transition-colors focus:border-accent"
          />
        </label>
        <label className="flex w-28 flex-col gap-1.5 text-sm">
          <span className="font-medium">Repeats</span>
          <input
            type="number"
            min={1}
            max={5}
            value={repeats}
            onChange={(e) => setRepeats(Number(e.target.value))}
            className="rounded-lg border border-line bg-bg px-3 py-2 font-mono tabular-nums outline-none transition-colors focus:border-accent"
          />
        </label>
        <label className="flex w-28 flex-col gap-1.5 text-sm">
          <span className="font-medium">RPM</span>
          <input
            type="number"
            min={0.1}
            max={60}
            step={0.1}
            value={rpm}
            onChange={(e) => setRpm(Number(e.target.value))}
            className="rounded-lg border border-line bg-bg px-3 py-2 font-mono tabular-nums outline-none transition-colors focus:border-accent"
          />
        </label>
      </div>
      <p className="text-xs text-muted">
        Requests per minute against the target LLM. Local Qwen/Groq has a tight per-minute token budget — keep this at 1 for clean local results; raise it against Gemini or a less-constrained target.
      </p>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium">Prompt variant</span>
          <select
            value={promptVariant}
            onChange={(e) => setPromptVariant(e.target.value)}
            className="rounded-lg border border-line bg-bg px-3 py-2 outline-none transition-colors focus:border-accent"
          >
            <option value="">None (live prompt)</option>
            <option value="naming=degraded">naming=degraded (sensitivity proof)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2.5 text-sm">
          <input type="checkbox" checked={setBaseline} onChange={(e) => setSetBaseline(e.target.checked)} className="accent-accent" />
          Set as baseline when finished
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Eval token</span>
        <input
          type="password"
          value={evalToken}
          onChange={(e) => setEvalToken(e.target.value)}
          required
          placeholder="EVAL_TOKEN"
          autoComplete="off"
          className="rounded-lg border border-line bg-bg px-3 py-2 font-mono outline-none transition-colors focus:border-accent"
        />
        <span className="text-xs text-muted">The same shared secret the CLI uses — never stored, only sent with this request.</span>
      </label>

      {progress && !message && (
        <p className="text-sm text-muted">
          Running {progress.evalRunId.slice(0, 8)} — {progress.done}/{progress.total} so far. Keep this tab open — it&apos;s what&apos;s driving the run forward.
        </p>
      )}
      {message && <p className={`text-sm ${message.kind === "error" ? "text-danger" : "text-success"}`}>{message.text}</p>}

      <button
        type="submit"
        disabled={running}
        className="self-start rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {running ? "Running…" : "Start eval run"}
      </button>
    </form>
  );
}
