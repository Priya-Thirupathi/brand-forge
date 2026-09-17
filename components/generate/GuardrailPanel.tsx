import type { GenerateResult } from "@/lib/contracts/generate";

// Run diagnostics — quality retries plus the meta the service records (models, prompt
// versions, latency, transport retries, tokens). Shown regardless of outcome; RejectionNotice
// covers the guardrail failure itself.
export function GuardrailPanel({ result }: { result: GenerateResult }) {
  const { guardrails, meta } = result;
  return (
    <details className="group rounded-xl border border-line bg-surface p-4 text-sm">
      <summary className="cursor-pointer font-medium text-muted group-open:text-ink">Under the hood for this run</summary>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[13px] tabular-nums sm:grid-cols-3">
        <div>
          <dt className="font-sans text-xs text-muted">Quality retries</dt>
          <dd>{guardrails.quality_retries}</dd>
        </div>
        <div>
          <dt className="font-sans text-xs text-muted">Transport retries</dt>
          <dd>{meta.transport_retries}</dd>
        </div>
        <div>
          <dt className="font-sans text-xs text-muted">Latency</dt>
          <dd>{meta.latency_ms} ms</dd>
        </div>
        <div>
          <dt className="font-sans text-xs text-muted">Tokens (in/out/thinking)</dt>
          <dd>
            {meta.tokens.input}/{meta.tokens.output}/{meta.tokens.thinking}
          </dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="font-sans text-xs text-muted">Models</dt>
          <dd className="break-words">{Object.values(meta.models).join(", ") || "—"}</dd>
        </div>
      </dl>
    </details>
  );
}
