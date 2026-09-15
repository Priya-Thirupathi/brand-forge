import { NextResponse } from "next/server";

// TRD.md §8: Stage 2 fills this in once eval_runs/eval_results exist. Stage 1 just needs the
// route to exist and return a shape the future eval dashboard can already point at.
export async function GET() {
  return NextResponse.json({ runs: [] });
}
