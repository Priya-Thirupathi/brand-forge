"use client";

import { useState } from "react";

interface EvalRunFormProps {
  onStarted: () => void;
}

// TRD.md §8 / DECISIONS.md D3: authenticated the same way eval-sourced generations already
// are — EVAL_TOKEN isn't stored anywhere by this form, just held in component state for the
// one request, since there's no account system to remember it against (TRD.md §15).
export function EvalRunForm({ onStarted }: EvalRunFormProps) {
  const [label, setLabel] = useState("");
  const [repeats, setRepeats] = useState(1);
  const [promptVariant, setPromptVariant] = useState("");
  const [setBaseline, setSetBaseline] = useState(false);
  const [evalToken, setEvalToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/eval/run", {
        method: "POST",
        headers: { "content-type": "application/json", "x-eval-token": evalToken },
        body: JSON.stringify({
          label,
          repeats,
          prompt_variant: promptVariant || undefined,
          set_baseline: setBaseline,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage({ kind: "error", text: body.message ?? "Could not start the eval run." });
        return;
      }
      setMessage({ kind: "success", text: `Started eval run ${body.eval_run_id.slice(0, 8)} — this runs for a while; check back below.` });
      onStarted();
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server." });
    } finally {
      setSubmitting(false);
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
      </div>

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

      {message && <p className={`text-sm ${message.kind === "error" ? "text-danger" : "text-success"}`}>{message.text}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="self-start rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? "Starting…" : "Start eval run"}
      </button>
    </form>
  );
}
