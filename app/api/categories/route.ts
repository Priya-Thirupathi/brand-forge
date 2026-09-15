import { NextResponse } from "next/server";
import { pool } from "@/lib/adapters/postgres/pool";
import { listCategories } from "@/lib/adapters/postgres/catalog";

export async function GET() {
  const categories = await listCategories(pool);
  return NextResponse.json({ categories });
}
