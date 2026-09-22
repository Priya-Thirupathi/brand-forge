import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/lib/adapters/postgres/pool";
import { createLlmClient } from "@/lib/adapters/createLlmClient";
import { countEvalResults, createEvalRun, finishEvalRun, getEvalRun, getLastResultTimestamp, listEvalResults, setBaseline } from "@/lib/adapters/postgres/evalStore";
import { computeAggregate } from "@/lib/eval/aggregate";
import { runEvalFixture } from "@/lib/eval/runner";
import { FIXTURE_CASES, FIXTURE_VERSION } from "@/lib/eval/fixture";
import { errorResponse, validationErrorResponse } from "../../_shared/response";
import { evalTokenMatches } from "../../_shared/evalAuth";

// Triggers a fixture run from the app itself, instead of only from the CLI. This reverses part
// of D3's original "no POST /api/eval/run" call — see DECISIONS.md D3 for why.
//
// D3's Vercel fix: this handler no longer fires the run as a background task and returns early
// (that only kept executing on a persistent Node process, never guaranteed on Vercel serverless).
// Instead every call is a bounded, *awaited* chunk — usually one case × repeat — that returns
// once it's done or once continuing would run past CHUNK_BUDGET_MS. The caller (EvalRunForm)
// drives the run forward by re-calling with `resume_eval_run_id` until the response says
// "completed". rpm pacing survives across those separate invocations via `getLastResultTimestamp`
// seeding the pacer's clock, since each call is otherwise a fresh process with no memory of it.
export const maxDuration = 30;

// Small on purpose: combined with rpm pacing (seeded from the last persisted result), this makes
// a chunk advance the fixture by about one case × repeat, leaving headroom under `maxDuration`
// for that one call's worst case (the app's own 25s per-run deadline).
const CHUNK_BUDGET_MS = 3_000;

const RequestSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  repeats: z.number().int().min(1).max(5).default(1),
  prompt_variant: z.string().optional(),
  // D32: same string shape the CLI's --model-tier takes; validated by the generate route, which
  // 400s on anything it doesn't recognise rather than falling back to committed routing.
  model_tier: z.string().optional(),
  set_baseline: z.boolean().default(false),
  resume_eval_run_id: z.string().uuid().optional(),
  rpm: z.number().min(0.1).max(60).optional(),
});

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-eval-token");
  const expected = process.env.EVAL_TOKEN;
  if (!token || !expected || !evalTokenMatches(token, expected)) {
    return errorResponse("invalid_eval_token", "This target does not accept eval traffic.", 401);
  }

  const json = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(json);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }
  const { label, prompt_variant: promptVariant, model_tier: modelTier, set_baseline: setBaselineFlag, resume_eval_run_id: resumeId, rpm } = parsed.data;

  let evalRunId: string;
  let repeats: number;
  if (resumeId) {
    const existing = await getEvalRun(pool, resumeId);
    if (!existing) {
      return errorResponse("unknown_eval_run", `No eval run ${resumeId}.`, 404);
    }
    evalRunId = resumeId;
    // The run's own repeats, not whatever this particular chunk request happened to send —
    // it was fixed when the run was created and must stay consistent across every chunk.
    repeats = existing.repeats;
  } else {
    if (!label) {
      return errorResponse("invalid_input", "label is required unless resume_eval_run_id is given.", 400);
    }
    repeats = parsed.data.repeats;
    evalRunId = await createEvalRun(pool, {
      label,
      gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
      target: request.nextUrl.origin,
      fixtureVersion: FIXTURE_VERSION,
      repeats,
    });
  }

  const lastResultAt = await getLastResultTimestamp(pool, evalRunId);
  const { completed, nextAvailableAt } = await runEvalFixture({
    target: request.nextUrl.origin,
    evalToken: token,
    evalRunId,
    repeats,
    promptVariant,
    modelTier,
    rpm: rpm ?? Number(process.env.EVAL_TARGET_RPM ?? 6),
    pool,
    judgeClient: createLlmClient(),
    deadlineMs: Date.now() + CHUNK_BUDGET_MS,
    seedLastCallAt: lastResultAt?.getTime(),
  });

  const casesDone = await countEvalResults(pool, evalRunId);
  const casesTotal = FIXTURE_CASES.length * repeats;

  if (!completed) {
    return NextResponse.json(
      {
        eval_run_id: evalRunId,
        status: "in_progress",
        cases_done: casesDone,
        cases_total: casesTotal,
        retry_after_ms: Math.max(0, (nextAvailableAt ?? Date.now()) - Date.now()),
      },
      { status: 202 },
    );
  }

  const results = await listEvalResults(pool, evalRunId);
  await finishEvalRun(pool, evalRunId, computeAggregate(results));
  if (setBaselineFlag) {
    await setBaseline(pool, evalRunId);
  }

  return NextResponse.json({ eval_run_id: evalRunId, status: "completed", cases_done: casesDone, cases_total: casesTotal }, { status: 200 });
}
