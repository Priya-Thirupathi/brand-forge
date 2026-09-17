import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/lib/adapters/postgres/pool";
import { createLlmClient } from "@/lib/adapters/createLlmClient";
import { createEvalRun, evalRunExists, finishEvalRun, listEvalResults, setBaseline } from "@/lib/adapters/postgres/evalStore";
import { computeAggregate } from "@/lib/eval/aggregate";
import { runEvalFixture } from "@/lib/eval/runner";
import { FIXTURE_VERSION } from "@/lib/eval/fixture";
import { errorResponse, validationErrorResponse } from "../../_shared/response";
import { evalTokenMatches } from "../../_shared/evalAuth";

// Triggers a full fixture run from the app itself, instead of only from the CLI. This reverses
// part of D3's original "no POST /api/eval/run" call — see DECISIONS.md D3 for why, and its
// important caveat: the run continues in the background *after* this handler returns, which
// only actually keeps executing on a persistent Node process (`next dev`, or a self-hosted
// `next start`). On Vercel's serverless functions specifically, compute is not guaranteed to
// continue past the response — this endpoint is not yet safe to expose there unqualified.
export const maxDuration = 30;

const RequestSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  repeats: z.number().int().min(1).max(5).default(1),
  prompt_variant: z.string().optional(),
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
  const { label, repeats, prompt_variant: promptVariant, set_baseline: setBaselineFlag, resume_eval_run_id: resumeId, rpm } = parsed.data;

  let evalRunId: string;
  if (resumeId) {
    if (!(await evalRunExists(pool, resumeId))) {
      return errorResponse("unknown_eval_run", `No eval run ${resumeId}.`, 404);
    }
    evalRunId = resumeId;
  } else {
    if (!label) {
      return errorResponse("invalid_input", "label is required unless resume_eval_run_id is given.", 400);
    }
    evalRunId = await createEvalRun(pool, {
      label,
      gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
      target: request.nextUrl.origin,
      fixtureVersion: FIXTURE_VERSION,
      repeats,
    });
  }

  // Not awaited on purpose — see the module comment above. Errors are logged, not thrown,
  // since there's no request left to report them to.
  void runInBackground({
    evalRunId,
    target: request.nextUrl.origin,
    evalToken: token,
    repeats,
    promptVariant,
    rpm: rpm ?? Number(process.env.EVAL_TARGET_RPM ?? 6),
    setBaselineOnFinish: setBaselineFlag,
  });

  return NextResponse.json({ eval_run_id: evalRunId, status: "started" }, { status: 202 });
}

interface BackgroundRunOptions {
  evalRunId: string;
  target: string;
  evalToken: string;
  repeats: number;
  promptVariant?: string;
  rpm: number;
  setBaselineOnFinish: boolean;
}

async function runInBackground(options: BackgroundRunOptions): Promise<void> {
  try {
    await runEvalFixture({
      target: options.target,
      evalToken: options.evalToken,
      evalRunId: options.evalRunId,
      repeats: options.repeats,
      promptVariant: options.promptVariant,
      rpm: options.rpm,
      pool,
      judgeClient: createLlmClient(),
    });

    const results = await listEvalResults(pool, options.evalRunId);
    await finishEvalRun(pool, options.evalRunId, computeAggregate(results));
    if (options.setBaselineOnFinish) {
      await setBaseline(pool, options.evalRunId);
    }
  } catch (error) {
    // No request left to report this to once we're here — the server log is it.
    console.error(`eval run ${options.evalRunId} failed`, error);
  }
}
