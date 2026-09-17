import type { GenerateResult } from "@/lib/contracts/generate";

export function RejectionNotice({ result }: { result: GenerateResult }) {
  const failure = result.guardrails.failure;
  if (!failure) return null;

  return (
    <div className="rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning-soft-ink">
      <p className="font-medium">Rejected at {failure.step === "input" ? "input" : failure.step.replace("_", " ")}</p>
      <ul className="mt-2 list-inside list-disc space-y-0.5">
        {failure.violations.map((v, i) => (
          <li key={i}>{v.message}</li>
        ))}
      </ul>
    </div>
  );
}
