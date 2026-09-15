// TRD.md §10: first address of x-forwarded-for, else x-real-ip; raw IP never stored (see
// ipHash.ts). Mirrors booking-app/lib/rateLimit.ts's getClientIp.
export function getClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip");
}
