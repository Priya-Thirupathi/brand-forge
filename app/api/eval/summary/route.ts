import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/lib/adapters/postgres/pool";
import { listEvalRunSummaries } from "@/lib/adapters/postgres/evalStore";
import { validationErrorResponse } from "../../_shared/response";

// TRD.md §8: recent eval_runs (newest first), never eval_results detail.
const QuerySchema = z.object({
  label: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(request: NextRequest) {
  const parsed = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  const runs = await listEvalRunSummaries(pool, parsed.data);
  return NextResponse.json({ runs });
}
