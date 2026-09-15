import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/lib/adapters/postgres/pool";
import { getBrandWithProducts } from "@/lib/adapters/postgres/gallery";
import { errorResponse } from "../../_shared/response";

const IdSchema = z.string().uuid();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A malformed uuid would otherwise reach Postgres as `invalid input syntax for type uuid`,
  // an unhandled 500 rather than the 404 a made-up id deserves.
  if (!IdSchema.safeParse(id).success) {
    return errorResponse("not_found", "No brand with that id.", 404);
  }

  const brand = await getBrandWithProducts(pool, id);
  if (!brand) {
    return errorResponse("not_found", "No brand with that id.", 404);
  }
  return NextResponse.json(brand);
}
