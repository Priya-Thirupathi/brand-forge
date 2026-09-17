import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createEvalRun,
  evalRunExists,
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
import { resetDb, testPool } from "../setup/testDb";

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
