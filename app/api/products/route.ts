import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/lib/adapters/postgres/pool";
import { listProducts } from "@/lib/adapters/postgres/gallery";
import { validationErrorResponse } from "../_shared/response";

// TRD.md §8: limit ≤ 48.
const QuerySchema = z.object({
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  cursor: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const parsed = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  const { products, nextCursor } = await listProducts(pool, parsed.data);
  return NextResponse.json({ products, next_cursor: nextCursor });
}
