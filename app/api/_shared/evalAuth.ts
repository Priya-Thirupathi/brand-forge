import { timingSafeEqual } from "node:crypto";

// Shared by app/api/generate/route.ts (eval-sourced generations) and app/api/eval/run/route.ts
// (triggering a run) — same shared-secret check either place a request claims to be the eval
// harness. Constant-time so a wrong token can't be brute-forced by timing the response
// (TRD.md §10).
export function evalTokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
