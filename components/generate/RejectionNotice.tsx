import type { GenerateResult } from "@/lib/contracts/generate";

export function RejectionNotice({ result }: { result: GenerateResult }) {
  const failure = result.guardrails.failure;
  if (!failure) return null;

  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950">
      <p className="font-medium text-amber-900 dark:text-amber-200">
        Rejected at {failure.step === "input" ? "input" : failure.step.replace("_", " ")}
      </p>
      <ul className="mt-2 list-inside list-disc text-amber-800 dark:text-amber-300">
        {failure.violations.map((v, i) => (
          <li key={i}>{v.message}</li>
        ))}
      </ul>
    </div>
  );
}
