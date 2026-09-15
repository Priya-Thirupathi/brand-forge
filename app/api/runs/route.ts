import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/lib/adapters/postgres/pool";
import { listRuns } from "@/lib/adapters/postgres/runs";
import { validationErrorResponse } from "../_shared/response";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(48).default(24),
  cursor: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const parsed = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  const { runs, nextCursor } = await listRuns(pool, parsed.data);
  return NextResponse.json({ runs, next_cursor: nextCursor });
}
