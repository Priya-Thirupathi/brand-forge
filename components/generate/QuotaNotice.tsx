import type { GenerateErrorCode } from "@/lib/contracts/generate";

// A run_error's `message` (lib/services/runGeneration.ts's RunErrorOutcome.message) is the raw
// upstream provider text — for a transport failure it's literally Gemini's stringified error
// body (e.g. `{"error":{"code":504,...,"status":"DEADLINE_EXCEEDED"}}`), not something to show
// as the headline to an end user. `code` is the fixed, already-classified vocabulary
// (GenerateErrorCodeSchema) this maps to a human sentence for; an admission_error has no code
// here because its `message` is already hand-authored in app/api/generate/route.ts.
const RUN_ERROR_MESSAGES: Record<GenerateErrorCode, string> = {
  quota_exhausted: "The free daily generation quota has been used up. Try again after it resets.",
  deadline_exceeded: "The generation took too long and timed out. Please try again.",
  provider_error: "The generation service had a temporary problem. Please try again.",
  aborted: "The generation was cancelled.",
  internal: "Something went wrong on our side. Please try again.",
};

interface QuotaNoticeProps {
  message: string;
  retryAfterS?: number;
  code?: GenerateErrorCode;
}

// retryAfterS is a safe upper bound, not a precise moment (rateLimitPolicy.ts) — "about 1
// hour" reads as the estimate it is; raw seconds ("about 3600s") reads as a bug.
function formatRetryAfter(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

export function QuotaNotice({ message, retryAfterS, code }: QuotaNoticeProps) {
  return (
    <div className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger-soft-ink">
      <p>{code ? RUN_ERROR_MESSAGES[code] : message}</p>
      {retryAfterS !== undefined && <p className="mt-1 text-xs opacity-80">Try again in about {formatRetryAfter(retryAfterS)}.</p>}
      {code && (
        <details className="mt-2 text-xs opacity-80">
          <summary className="cursor-pointer">Technical details</summary>
          <p className="mt-1 break-words font-mono">{message}</p>
        </details>
      )}
    </div>
  );
}
