interface QuotaNoticeProps {
  message: string;
  retryAfterS?: number;
}

// Covers both an admission_error (429 rate limit / daily cap, or another pre-admission error)
// and a run_error stream event (quota_exhausted, deadline_exceeded, provider_error, ...) — both
// are "the run didn't produce a result, here's why" states the reducer already distinguished.
export function QuotaNotice({ message, retryAfterS }: QuotaNoticeProps) {
  return (
    <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      <p>{message}</p>
      {retryAfterS !== undefined && <p className="mt-1 text-xs">Try again in about {retryAfterS}s.</p>}
    </div>
  );
}
