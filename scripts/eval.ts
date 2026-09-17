import { execSync } from "node:child_process";
import { parseArgs } from "node:util";
import { createDbPool } from "./dbClient";
import { createLlmClient } from "@/lib/adapters/createLlmClient";
import { createEvalRun, evalRunExists, getEvalRun, getLatestBaseline, listEvalResults, setBaseline, finishEvalRun, setEvalRunComparison } from "@/lib/adapters/postgres/evalStore";
import { FIXTURE_CASES, FIXTURE_VERSION } from "@/lib/eval/fixture";
import { runEvalFixture } from "@/lib/eval/runner";
import { computeAggregate, compareEvalRuns } from "@/lib/eval/aggregate";

// TRD.md §9 "CLI": `npm run eval -- generate ...` and `npm run eval -- compare ...`. A thin
// argv/console layer over lib/eval — all the actual logic lives there so it stays testable
// without spawning a process.

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "generate") return runGenerate(rest);
  if (command === "compare") return runCompare(rest);
  console.error('Usage: npm run eval -- generate --target URL --label NAME [--repeats 3] [--set-baseline] [--prompt-variant naming=degraded] [--resume EVAL_RUN_ID]');
  console.error("       npm run eval -- compare --run EVAL_RUN_ID [--baseline EVAL_RUN_ID]");
  process.exit(1);
}

async function runGenerate(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      target: { type: "string" },
      label: { type: "string" },
      repeats: { type: "string", default: "3" },
      "set-baseline": { type: "boolean", default: false },
      "prompt-variant": { type: "string" },
      resume: { type: "string" },
      rpm: { type: "string", default: process.env.EVAL_TARGET_RPM ?? "6" },
    },
  });

  const evalToken = process.env.EVAL_TOKEN;
  if (!evalToken) throw new Error("EVAL_TOKEN is not set (required to call a target's /api/generate as eval traffic)");
  if (!values.target) throw new Error("--target is required");
  const target = values.target.replace(/\/$/, "");
  const repeats = Number(values.repeats);
  const rpm = Number(values.rpm);

  const pool = createDbPool();
  try {
    let evalRunId: string;
    if (values.resume) {
      if (!(await evalRunExists(pool, values.resume))) throw new Error(`--resume ${values.resume}: no such eval run`);
      evalRunId = values.resume;
      console.log(`Resuming eval run ${evalRunId}`);
    } else {
      if (!values.label) throw new Error("--label is required (unless --resume)");
      evalRunId = await createEvalRun(pool, {
        label: values.label,
        gitSha: gitSha(),
        target,
        fixtureVersion: FIXTURE_VERSION,
        repeats,
      });
      console.log(`Created eval run ${evalRunId} (label "${values.label}", fixture ${FIXTURE_VERSION}, ${FIXTURE_CASES.length} cases × ${repeats} repeats)`);
    }

    await runEvalFixture({
      target,
      evalToken,
      evalRunId,
      repeats,
      promptVariant: values["prompt-variant"],
      rpm,
      pool,
      judgeClient: createLlmClient(),
      onEvent: (event) => {
        if (event.type === "case_skipped") console.log(`  skip  ${event.caseId} #${event.repeat} (already recorded)`);
        if (event.type === "case_started") console.log(`  run   ${event.caseId} #${event.repeat}`);
        if (event.type === "case_finished") {
          const row = event.row;
          const mark = row.outcome_match ? "ok" : "MISMATCH";
          console.log(`  done  ${event.caseId} #${event.repeat}: expected ${row.expected_outcome}, got ${row.actual_outcome} [${mark}]`);
        }
      },
    });

    const results = await listEvalResults(pool, evalRunId);
    const aggregate = computeAggregate(results);
    await finishEvalRun(pool, evalRunId, aggregate);
    console.log(`Finished eval run ${evalRunId}: outcome_match_rate=${(aggregate.outcome_match_rate * 100).toFixed(1)}% mean_relevance=${aggregate.mean_relevance?.toFixed(2) ?? "n/a"}`);

    if (values["set-baseline"]) {
      await setBaseline(pool, evalRunId);
      console.log(`Marked ${evalRunId} as the baseline.`);
    }
  } finally {
    await pool.end();
  }
}

async function runCompare(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      run: { type: "string" },
      baseline: { type: "string" },
    },
  });
  if (!values.run) throw new Error("--run EVAL_RUN_ID is required");

  const pool = createDbPool();
  try {
    const candidate = await getEvalRun(pool, values.run);
    if (!candidate) throw new Error(`No eval run ${values.run}`);

    const baseline = values.baseline ? await getEvalRun(pool, values.baseline) : await getLatestBaseline(pool);
    if (!baseline) throw new Error("No baseline eval run found — pass --baseline EVAL_RUN_ID, or run `generate --set-baseline` first.");
    if (baseline.id === candidate.id) throw new Error("--run and --baseline must be different eval runs.");

    const [baselineResults, candidateResults] = await Promise.all([listEvalResults(pool, baseline.id), listEvalResults(pool, candidate.id)]);

    const comparison = compareEvalRuns(baseline.id, baselineResults, candidateResults);
    await setEvalRunComparison(pool, candidate.id, comparison);

    console.log(`Comparing ${candidate.label} (${candidate.id}) vs. baseline ${baseline.label} (${baseline.id})`);
    for (const [name, delta] of Object.entries({
      relevance: comparison.relevance,
      distinctiveness: comparison.distinctiveness,
      outcome_match_rate: comparison.outcome_match_rate,
      latency_ms: comparison.latency_ms,
    })) {
      const flag = delta.flagged ? "FLAGGED" : "ok";
      console.log(`  ${name.padEnd(20)} baseline=${delta.baseline_mean.toFixed(3)} candidate=${delta.candidate_mean.toFixed(3)} delta=${delta.delta.toFixed(3)} ci=[${delta.ci_low.toFixed(3)}, ${delta.ci_high.toFixed(3)}] ${flag}`);
    }
  } finally {
    await pool.end();
  }
}

function gitSha(): string {
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
