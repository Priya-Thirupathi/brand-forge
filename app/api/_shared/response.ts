import { NextResponse } from "next/server";
import type { ZodError } from "zod";

// TRD.md §8: every non-2xx body is `{ error: code, message }`. `_shared/` (not `route.ts`) so
// Next.js doesn't treat this as a route of its own.
export function validationErrorResponse(error: ZodError) {
  return NextResponse.json({ error: "invalid_input", message: error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
}

export function errorResponse(error: string, message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, message, ...extra }, { status });
}
