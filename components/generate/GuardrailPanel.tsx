import type { GenerateResult } from "@/lib/contracts/generate";

// Run diagnostics — quality retries plus the meta the service records (models, prompt
// versions, latency, transport retries, tokens). Shown regardless of outcome; RejectionNotice
// covers the guardrail failure itself.
export function GuardrailPanel({ result }: { result: GenerateResult }) {
  const { guardrails, meta } = result;
  return (
    <details className="rounded border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <summary className="cursor-pointer font-medium">Run details</summary>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
        <dt className="text-zinc-500">Quality retries</dt>
        <dd>{guardrails.quality_retries}</dd>
        <dt className="text-zinc-500">Transport retries</dt>
        <dd>{meta.transport_retries}</dd>
        <dt className="text-zinc-500">Latency</dt>
        <dd>{meta.latency_ms} ms</dd>
        <dt className="text-zinc-500">Tokens (in/out/thinking)</dt>
        <dd>
          {meta.tokens.input}/{meta.tokens.output}/{meta.tokens.thinking}
        </dd>
        <dt className="text-zinc-500">Models</dt>
        <dd>{Object.values(meta.models).join(", ") || "—"}</dd>
      </dl>
    </details>
  );
}
