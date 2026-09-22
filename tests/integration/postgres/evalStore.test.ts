import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createEvalRun,
  evalRunExists,
  findEvalCaseBrandId,
  listJudgedOutputs,
  finishEvalRun,
  getEvalRun,
  getLatestBaseline,
  hasEvalResult,
  insertEvalResult,
  listEvalResults,
  listEvalRunSummaries,
  setBaseline,
  setEvalRunComparison,
  setEvalRunMeta,
} from "@/lib/adapters/postgres/evalStore";
import type { EvalAggregate, EvalComparison, EvalResultRow } from "@/lib/contracts/eval";
import { resetDb, seedCategory, testPool } from "../setup/testDb";

beforeEach(resetDb);
afterAll(async () => {
  await testPool.end();
});

function newEvalRun(overrides: Partial<Parameters<typeof createEvalRun>[1]> = {}) {
  return { label: "test-run", gitSha: "abc123", target: "http://localhost:3000", fixtureVersion: "fixture-v1", repeats: 1, ...overrides };
}

function resultRow(evalRunId: string, overrides: Partial<EvalResultRow> = {}): EvalResultRow {
  return {
    eval_run_id: evalRunId,
    case_id: "n01",
    repeat: 1,
    run_id: null,
    expected_outcome: "pass",
    actual_outcome: "pass",
    outcome_match: true,
    first_attempt_pass: true,
    quality_retries: 0,
    throttled: false,
    latency_ms: 1200,
    first_event_ms: 300,
    input_tokens: 100,
    output_tokens: 200,
    thinking_tokens: 0,
    relevance_score: 0.9,
    distinctiveness_score: 0.8,
    name_uniqueness: 1,
    judge_reason: "fits the idea well",
    tone_fit_score: null,
    tone_fit_reason: null,
    ...overrides,
  };
}

const aggregate: EvalAggregate = {
  cases: 1,
  repeats: 1,
  outcome_match_rate: 1,
  first_attempt_pass_rate: 1,
  mean_quality_retries: 0,
  throttled_rate: 0,
  mean_relevance: 0.9,
  mean_distinctiveness: 0.8,
  mean_name_uniqueness: 1,
      mean_tone_fit: null,
  latency_ms_p50: 1200,
  latency_ms_p95: 1200,
  first_event_ms_p50: 300,
  mean_tokens: { input: 100, output: 200, thinking: 0 },
};

describe("evalStore", () => {
  it("creates an eval run with empty prompt_versions/models until setEvalRunMeta fills them in", async () => {
    const id = await createEvalRun(testPool, newEvalRun());
    expect(await evalRunExists(testPool, id)).toBe(true);

    const row = await getEvalRun(testPool, id);
    expect(row?.prompt_versions).toEqual({});
    expect(row?.models).toEqual({});

    await setEvalRunMeta(testPool, id, { promptVersions: { naming: "hash1" }, models: { naming: "gemini-3.8-flash", judge: "gemini-3.5-flash-lite" } });
    const updated = await getEvalRun(testPool, id);
    expect(updated?.prompt_versions).toEqual({ naming: "hash1" });
    expect(updated?.models).toEqual({ naming: "gemini-3.8-flash", judge: "gemini-3.5-flash-lite" });
  });

  it("evalRunExists is false for an unknown id", async () => {
    expect(await evalRunExists(testPool, "00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  it("hasEvalResult / insertEvalResult support the resume skip-check, idempotently on conflict", async () => {
    const id = await createEvalRun(testPool, newEvalRun());
    expect(await hasEvalResult(testPool, id, "n01", 1)).toBe(false);

    await insertEvalResult(testPool, resultRow(id));
    expect(await hasEvalResult(testPool, id, "n01", 1)).toBe(true);

    // A second insert for the same (eval_run_id, case_id, repeat) — e.g. a retried CLI
    // process racing itself — must not throw or duplicate the row (on conflict do nothing).
    await insertEvalResult(testPool, resultRow(id, { outcome_match: false }));
    const rows = await listEvalResults(testPool, id);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome_match).toBe(true); // the first insert won, not silently overwritten
  });

  it("listEvalResults returns every case × repeat row for one eval run, isolated from others", async () => {
    const id1 = await createEvalRun(testPool, newEvalRun({ label: "run-1" }));
    const id2 = await createEvalRun(testPool, newEvalRun({ label: "run-2" }));
    await insertEvalResult(testPool, resultRow(id1, { case_id: "n01" }));
    await insertEvalResult(testPool, resultRow(id1, { case_id: "n02" }));
    await insertEvalResult(testPool, resultRow(id2, { case_id: "n01" }));

    expect(await listEvalResults(testPool, id1)).toHaveLength(2);
    expect(await listEvalResults(testPool, id2)).toHaveLength(1);
  });

  it("finishEvalRun stores the aggregate and stamps finished_at", async () => {
    const id = await createEvalRun(testPool, newEvalRun());
    let row = await getEvalRun(testPool, id);
    expect(row?.finished_at).toBeNull();

    await finishEvalRun(testPool, id, aggregate);
    row = await getEvalRun(testPool, id);
    expect(row?.finished_at).not.toBeNull();
    expect(row?.aggregate).toEqual(aggregate);
  });

  it("setBaseline / getLatestBaseline promote a run and find the most recent baseline", async () => {
    expect(await getLatestBaseline(testPool)).toBeNull();

    const older = await createEvalRun(testPool, newEvalRun({ label: "older" }));
    await setBaseline(testPool, older);
    expect((await getLatestBaseline(testPool))?.id).toBe(older);

    const newer = await createEvalRun(testPool, newEvalRun({ label: "newer" }));
    await setBaseline(testPool, newer);
    expect((await getLatestBaseline(testPool))?.id).toBe(newer);
  });

  it("setEvalRunComparison stores the comparison payload", async () => {
    const id = await createEvalRun(testPool, newEvalRun());
    const comparison: EvalComparison = {
      baseline_eval_run_id: "some-baseline-id",
      relevance: { baseline_mean: 0.8, candidate_mean: 0.3, delta: -0.5, ci_low: -0.6, ci_high: -0.4, flagged: true },
      distinctiveness: { baseline_mean: 0.8, candidate_mean: 0.1, delta: -0.7, ci_low: -0.8, ci_high: -0.6, flagged: true },
      outcome_match_rate: { baseline_mean: 1, candidate_mean: 1, delta: 0, ci_low: 0, ci_high: 0, flagged: false },
      latency_ms: { baseline_mean: 1000, candidate_mean: 1000, delta: 0, ci_low: 0, ci_high: 0, flagged: false },
      tone_fit: null,
    };
    await setEvalRunComparison(testPool, id, comparison);
    const row = await getEvalRun(testPool, id);
    expect(row?.comparison).toEqual(comparison);
  });

  it("listEvalRunSummaries filters by label and never leaks eval_results rows", async () => {
    await createEvalRun(testPool, newEvalRun({ label: "keep-me" }));
    await createEvalRun(testPool, newEvalRun({ label: "not-this-one" }));

    const summaries = await listEvalRunSummaries(testPool, { label: "keep-me", limit: 10 });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].label).toBe("keep-me");
    expect(summaries[0]).not.toHaveProperty("eval_results");
  });
});

describe("findEvalCaseBrandId (D31)", () => {
  // A consistency case needs the brand its prerequisite created. That link only exists through
  // products.run_id, so this walks eval_results → products → brands the way the runner does
  // when the prerequisite ran in an earlier chunk or on an earlier day.
  async function seedSucceededCase(evalRunId: string, caseId: string, repeat: number, brandName: string): Promise<string> {
    const { rows: runRows } = await testPool.query<{ id: string }>(
      `insert into runs (source, idea, status, prompt_versions, client_ip_hash) values ('eval', 'idea', 'succeeded', '{}'::jsonb, 'h') returning id`,
    );
    const runId = runRows[0].id;
    const { rows: brandRows } = await testPool.query<{ id: string }>(
      `insert into brands (name, tone_notes, source) values ($1, '{"voice":[],"audience":"a","personality":"p","avoid":[]}'::jsonb, 'eval') returning id`,
      [brandName],
    );
    const brandId = brandRows[0].id;
    await testPool.query(
      `insert into products (brand_id, run_id, feasibility_snapshot, idea, tagline, description, packaging, source)
       values ($1, $2, '{}'::jsonb, 'idea', 't', 'd', '{}'::jsonb, 'eval')`,
      [brandId, runId],
    );
    await insertEvalResult(testPool, resultRow(evalRunId, { case_id: caseId, repeat, run_id: runId }));
    return brandId;
  }

  it("returns the brand from the earliest successful repeat", async () => {
    const evalRunId = await createEvalRun(testPool, newEvalRun());
    const firstBrandId = await seedSucceededCase(evalRunId, "n10", 1, "Ridge");
    await seedSucceededCase(evalRunId, "n10", 2, "Summit");

    // Deterministic across repeats on purpose — otherwise which brand c01 inherits would
    // depend on row order, and two eval runs of the same fixture wouldn't be comparable.
    expect(await findEvalCaseBrandId(testPool, evalRunId, "n10")).toBe(firstBrandId);
  });

  it("returns null when the case never passed, and ignores other eval runs' rows", async () => {
    const evalRunId = await createEvalRun(testPool, newEvalRun());
    const otherEvalRunId = await createEvalRun(testPool, newEvalRun());
    await seedSucceededCase(otherEvalRunId, "n10", 1, "Elsewhere");
    await insertEvalResult(testPool, resultRow(evalRunId, { case_id: "n10", actual_outcome: "reject", run_id: null }));

    expect(await findEvalCaseBrandId(testPool, evalRunId, "n10")).toBeNull();
  });
});

describe("listJudgedOutputs (D33)", () => {
  it("returns the copy a human needs to label, and only succeeded rows", async () => {
    const seeded = await seedCategory();
    const evalRunId = await createEvalRun(testPool, newEvalRun());
    const { rows: runRows } = await testPool.query<{ id: string }>(
      `insert into runs (source, idea, status, prompt_versions, client_ip_hash) values ('eval', 'idea', 'succeeded', '{}'::jsonb, 'h') returning id`,
    );
    const runId = runRows[0].id;
    const { rows: brandRows } = await testPool.query<{ id: string }>(
      `insert into brands (name, tone_notes, source) values ('Ridge', '{"voice":[],"audience":"a","personality":"p","avoid":[]}'::jsonb, 'eval') returning id`,
    );
    await testPool.query(
      `insert into products (brand_id, run_id, category, feasibility_snapshot, idea, tagline, description, packaging, source)
       values ($1, $2, $3, '{}'::jsonb, 'a lavender candle', 'Rest easy', 'A calming candle.', '{}'::jsonb, 'eval')`,
      [brandRows[0].id, runId, seeded.category],
    );
    await insertEvalResult(testPool, resultRow(evalRunId, { case_id: "n01", run_id: runId, relevance_score: 0.9, distinctiveness_score: 0.4 }));
    // A rejected case produced no copy, so there is nothing to put in front of a labeller.
    await insertEvalResult(testPool, resultRow(evalRunId, { case_id: "n02", actual_outcome: "reject", run_id: null }));

    const outputs = await listJudgedOutputs(testPool, evalRunId);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      case_id: "n01",
      name: "Ridge",
      tagline: "Rest easy",
      idea: "a lavender candle",
      relevance: 0.9,
      distinctiveness: 0.4,
    });
  });
});
