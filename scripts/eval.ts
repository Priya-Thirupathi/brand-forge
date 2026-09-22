import { execSync } from "node:child_process";
import { parseArgs } from "node:util";
import { createDbPool } from "./dbClient";
import { createLlmClient } from "@/lib/adapters/createLlmClient";
import { createEvalRun, evalRunExists, getEvalRun, getLatestBaseline, listEvalResults, listJudgedOutputs, setBaseline, finishEvalRun, setEvalRunComparison } from "@/lib/adapters/postgres/evalStore";
import { FIXTURE_CASES, FIXTURE_VERSION } from "@/lib/eval/fixture";
import { runEvalFixture } from "@/lib/eval/runner";
import { computeAggregate, compareEvalRuns } from "@/lib/eval/aggregate";
import { computeCalibration, selectForLabelling } from "@/lib/eval/calibration";
import { resolveJudgeModel } from "@/lib/eval/judge";
import { readFileSync, writeFileSync } from "node:fs";
import { LabelSheetSchema, parseEvalModelTiers, type LabelSheet } from "@/lib/contracts/eval";
import { resolveTier, tiersAreDistinct } from "@/config/routing";

// TRD.md §9 "CLI": `npm run eval -- generate ...` and `npm run eval -- compare ...`. A thin
// argv/console layer over lib/eval — all the actual logic lives there so it stays testable
// without spawning a process.

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "generate") return runGenerate(rest);
  if (command === "compare") return runCompare(rest);
  if (command === "export-labels") return runExportLabels(rest);
  if (command === "calibrate") return runCalibrate(rest);
  console.error('Usage: npm run eval -- generate --target URL --label NAME [--repeats 3] [--set-baseline] [--prompt-variant naming=degraded] [--model-tier naming=cheap] [--resume EVAL_RUN_ID]');
  console.error("       npm run eval -- compare --run EVAL_RUN_ID [--baseline EVAL_RUN_ID]");
  console.error("       npm run eval -- export-labels --run EVAL_RUN_ID --out labels.json [--limit 20]");
  console.error("       npm run eval -- calibrate --labels labels.json");
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
      "model-tier": { type: "string" },
      "allow-same-model": { type: "boolean", default: false },
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

  // D32: D12's routing experiment only means anything if the two tiers are actually different
  // models. On Groq/Qwen they are the same id (D26), so this would compare a model against
  // itself and report "no flagged regression" — a result that reads as evidence for moving a
  // step down while being nothing of the sort. Refuse by default rather than produce it.
  const modelTier = values["model-tier"];
  if (modelTier) {
    if (!parseEvalModelTiers(modelTier)) {
      throw new Error(`--model-tier ${modelTier}: expected e.g. "naming=cheap" or "naming=cheap,packaging=cheap"`);
    }
    if (!tiersAreDistinct() && !values["allow-same-model"]) {
      throw new Error(
        `--model-tier is pointless here: MODEL_STRONG and MODEL_CHEAP both resolve to "${resolveTier("strong")}", ` +
          "so this run would compare a model against itself and report no regression. " +
          "Set MODEL_CHEAP to a genuinely different model, or pass --allow-same-model if you " +
          "really do want a control run against identical routing.",
      );
    }
  }

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
      modelTier,
      rpm,
      pool,
      judgeClient: createLlmClient(),
      onEvent: (event) => {
        if (event.type === "case_skipped") console.log(`  skip  ${event.caseId} #${event.repeat} (already recorded)`);
        if (event.type === "case_started") console.log(`  run   ${event.caseId} #${event.repeat}`);
        // D31: says *why* a consistency case couldn't run, rather than leaving a bare error row
        // in the results for someone to reverse-engineer later.
        if (event.type === "case_unresolved") {
          console.log(`  skip  ${event.caseId} #${event.repeat}: "${event.followUpTo}" produced no brand to follow up on`);
        }
        if (event.type === "case_finished") {
          const row = event.row;
          const mark = row.outcome_match ? "ok" : "MISMATCH";
          const tone = row.tone_fit_score === null ? "" : ` tone_fit=${row.tone_fit_score.toFixed(2)}`;
          console.log(`  done  ${event.caseId} #${event.repeat}: expected ${row.expected_outcome}, got ${row.actual_outcome} [${mark}]${tone}`);
        }
      },
    });

    const results = await listEvalResults(pool, evalRunId);
    const aggregate = computeAggregate(results);
    await finishEvalRun(pool, evalRunId, aggregate);
    console.log(`Finished eval run ${evalRunId}: outcome_match_rate=${(aggregate.outcome_match_rate * 100).toFixed(1)}% mean_relevance=${aggregate.mean_relevance?.toFixed(2) ?? "n/a"} mean_tone_fit=${aggregate.mean_tone_fit?.toFixed(2) ?? "n/a"}`);

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

// D33: writes a blind labelling sheet. The judge's own scores are deliberately left out of the
// file — seeing them while labelling anchors the labeller to the thing being audited, and the
// agreement number would then measure suggestibility rather than the judge.
async function runExportLabels(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: { run: { type: "string" }, out: { type: "string" }, limit: { type: "string", default: "20" } },
  });
  if (!values.run) throw new Error("--run is required");
  if (!values.out) throw new Error("--out is required (path to write the label sheet to)");

  const pool = createDbPool();
  try {
    if (!(await evalRunExists(pool, values.run))) throw new Error(`--run ${values.run}: no such eval run`);
    const outputs = await listJudgedOutputs(pool, values.run);
    if (outputs.length === 0) throw new Error(`Eval run ${values.run} has no succeeded outputs to label`);

    const selected = selectForLabelling(outputs, Number(values.limit));
    const sheet: LabelSheet = {
      eval_run_id: values.run,
      judge_model: resolveJudgeModel(),
      items: selected.map((output) => ({
        case_id: output.case_id,
        repeat: output.repeat,
        category: output.category,
        idea: output.idea,
        name: output.name,
        tagline: output.tagline,
        description: output.description,
        human_relevance: null,
        human_distinctiveness: null,
      })),
    };
    writeFileSync(values.out, JSON.stringify(sheet, null, 2) + "\n");
    console.log(`Wrote ${sheet.items.length} outputs to ${values.out} (judge ${sheet.judge_model}).`);
    console.log("Fill in human_relevance and human_distinctiveness (0-1, null to skip), then:");
    console.log(`  npm run eval -- calibrate --labels ${values.out}`);
  } finally {
    await pool.end();
  }
}

async function runCalibrate(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { labels: { type: "string" } } });
  if (!values.labels) throw new Error("--labels is required (the filled-in sheet from export-labels)");

  const parsed = LabelSheetSchema.safeParse(JSON.parse(readFileSync(values.labels, "utf8")));
  if (!parsed.success) {
    // The file is hand-edited, so a typo is the expected failure, not an exotic one.
    throw new Error(`${values.labels} is not a valid label sheet: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const sheet = parsed.data;

  const pool = createDbPool();
  try {
    const judged = await listJudgedOutputs(pool, sheet.eval_run_id);
    const report = computeCalibration(sheet.eval_run_id, sheet.judge_model, sheet.items, judged);

    const currentJudge = resolveJudgeModel();
    if (currentJudge !== sheet.judge_model) {
      console.log(`Note: sheet was exported against judge "${sheet.judge_model}", current JUDGE_MODEL is "${currentJudge}".`);
      console.log("The scores being compared are the ones stored at generation time, not this model's.");
    }

    console.log(`Calibration for eval run ${report.eval_run_id} (judge ${report.judge_model}):`);
    for (const [name, dim] of [["relevance", report.relevance], ["distinctiveness", report.distinctiveness]] as const) {
      if (dim.labelled === 0) {
        console.log(`  ${name.padEnd(16)} no labels filled in`);
        continue;
      }
      const rank = dim.rank_correlation === null ? "n/a (no variation to rank)" : dim.rank_correlation.toFixed(2);
      const direction = dim.bias > 0 ? "judge scores higher than you" : dim.bias < 0 ? "judge scores lower than you" : "no systematic bias";
      console.log(`  ${name.padEnd(16)} n=${dim.labelled} mae=${dim.mean_absolute_error.toFixed(2)} bias=${dim.bias >= 0 ? "+" : ""}${dim.bias.toFixed(2)} (${direction})`);
      console.log(`  ${" ".repeat(16)} rank_correlation=${rank} threshold_agreement=${(dim.threshold_agreement * 100).toFixed(0)}%`);
    }
    console.log("");
    console.log("rank_correlation is the number that matters for comparing two eval runs: it says whether");
    console.log("the judge orders outputs the way you do. bias only shifts every run equally, so a paired");
    console.log("comparison (D18) already cancels it out.");
  } finally {
    await pool.end();
  }
}
