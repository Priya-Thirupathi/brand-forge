import { describe, expect, it } from "vitest";
import { compareEvalRuns, computeAggregate } from "@/lib/eval/aggregate";
import type { EvalResultRow } from "@/lib/contracts/eval";

function row(overrides: Partial<EvalResultRow> = {}): EvalResultRow {
  return {
    eval_run_id: "run-1",
    case_id: "n01",
    repeat: 1,
    run_id: "gen-run-1",
    expected_outcome: "pass",
    actual_outcome: "pass",
    outcome_match: true,
    first_attempt_pass: true,
    quality_retries: 0,
    throttled: false,
    latency_ms: 1000,
    first_event_ms: 200,
    input_tokens: 50,
    output_tokens: 100,
    thinking_tokens: 0,
    relevance_score: 0.8,
    distinctiveness_score: 0.7,
    name_uniqueness: 1,
    judge_reason: "fits",
    ...overrides,
  };
}

describe("computeAggregate", () => {
  it("computes rates and means across mixed outcomes", () => {
    const results = [
      row({ case_id: "n01" }),
      row({ case_id: "n02", outcome_match: false, first_attempt_pass: false, quality_retries: 1, latency_ms: 2000 }),
      row({ case_id: "a01", expected_outcome: "safe", actual_outcome: "reject", outcome_match: true, first_attempt_pass: null, relevance_score: null, distinctiveness_score: null, name_uniqueness: null, latency_ms: null }),
    ];
    const aggregate = computeAggregate(results);

    expect(aggregate.cases).toBe(3);
    expect(aggregate.outcome_match_rate).toBeCloseTo(2 / 3);
    expect(aggregate.first_attempt_pass_rate).toBeCloseTo(1 / 2); // only the 2 non-null rows count
    expect(aggregate.mean_relevance).toBeCloseTo(0.8); // only the 2 rows with a score
    expect(aggregate.latency_ms_p50).not.toBeNull();
  });

  it("excludes throttled rows from latency percentiles but not from other rates", () => {
    const results = [row({ latency_ms: 1000, throttled: false }), row({ latency_ms: 60_000, throttled: true })];
    const aggregate = computeAggregate(results);
    expect(aggregate.latency_ms_p50).toBe(1000); // the 60s throttled wait never counts as latency
    expect(aggregate.throttled_rate).toBeCloseTo(0.5);
  });

  it("returns nulls, not NaN, for an empty result set", () => {
    const aggregate = computeAggregate([]);
    expect(aggregate.cases).toBe(0);
    expect(aggregate.outcome_match_rate).toBe(0);
    expect(aggregate.mean_relevance).toBeNull();
    expect(aggregate.latency_ms_p50).toBeNull();
  });
});

describe("compareEvalRuns", () => {
  it("pairs by case, averaging repeats within each case first", () => {
    const baseline = [
      row({ case_id: "n01", repeat: 1, relevance_score: 0.9 }),
      row({ case_id: "n01", repeat: 2, relevance_score: 0.7 }), // case n01's mean = 0.8
      row({ case_id: "n02", repeat: 1, relevance_score: 0.6 }),
    ];
    const candidate = [
      row({ case_id: "n01", repeat: 1, relevance_score: 0.3 }),
      row({ case_id: "n01", repeat: 2, relevance_score: 0.3 }), // case n01's mean = 0.3
      row({ case_id: "n02", repeat: 1, relevance_score: 0.6 }), // unchanged
    ];
    const comparison = compareEvalRuns("baseline-id", baseline, candidate);
    expect(comparison.baseline_eval_run_id).toBe("baseline-id");
    // mean(baseline case means) = (0.8+0.6)/2 = 0.7; mean(candidate case means) = (0.3+0.6)/2 = 0.45
    expect(comparison.relevance.baseline_mean).toBeCloseTo(0.7);
    expect(comparison.relevance.candidate_mean).toBeCloseTo(0.45);
  });

  it("only pairs case ids present with a non-null metric on both sides", () => {
    const baseline = [row({ case_id: "n01", relevance_score: 0.9 }), row({ case_id: "a01", relevance_score: null, actual_outcome: "reject" })];
    const candidate = [row({ case_id: "n01", relevance_score: 0.9 }), row({ case_id: "n02", relevance_score: 0.5 })]; // n02 has no baseline counterpart, a01 has no candidate score
    const comparison = compareEvalRuns("baseline-id", baseline, candidate);
    expect(comparison.relevance.baseline_mean).toBeCloseTo(0.9);
    expect(comparison.relevance.candidate_mean).toBeCloseTo(0.9);
    expect(comparison.relevance.delta).toBeCloseTo(0);
  });

  it("uses a relative threshold for latency, matching compareMetric's contract", () => {
    const baseline = Array.from({ length: 10 }, (_, i) => row({ case_id: `n${i}`, latency_ms: 1000 }));
    const candidate = Array.from({ length: 10 }, (_, i) => row({ case_id: `n${i}`, latency_ms: 1050 })); // +5%
    const comparison = compareEvalRuns("baseline-id", baseline, candidate);
    expect(comparison.latency_ms.flagged).toBe(false);
  });
});
