import type { EvalAggregate, EvalComparison, EvalResultRow } from "@/lib/contracts/eval";
import { compareMetric, mean } from "./stats";

// TRD.md §9 "Metrics"/"Comparison" — turns a flat list of eval_results rows (one eval run's
// worth) into the aggregate stored on eval_runs.aggregate, and turns two eval runs' rows into
// the paired comparison stored on eval_runs.comparison.

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function nonNull<T>(values: readonly (T | null)[]): T[] {
  return values.filter((v): v is T => v !== null);
}

export function computeAggregate(results: readonly EvalResultRow[]): EvalAggregate {
  const cases = new Set(results.map((r) => r.case_id)).size;
  const repeats = results.length > 0 ? Math.max(...results.map((r) => r.repeat)) : 0;

  const firstEventTimes = nonNull(results.map((r) => r.first_event_ms));
  const relevances = nonNull(results.map((r) => r.relevance_score));
  const distinctivenesses = nonNull(results.map((r) => r.distinctiveness_score));
  const uniquenesses = nonNull(results.map((r) => r.name_uniqueness));
  const qualityRetries = nonNull(results.map((r) => r.quality_retries));
  const firstAttemptPasses = nonNull(results.map((r) => r.first_attempt_pass));

  return {
    cases,
    repeats,
    outcome_match_rate: results.length > 0 ? results.filter((r) => r.outcome_match).length / results.length : 0,
    first_attempt_pass_rate: firstAttemptPasses.length > 0 ? firstAttemptPasses.filter(Boolean).length / firstAttemptPasses.length : 0,
    mean_quality_retries: mean(qualityRetries),
    throttled_rate: results.length > 0 ? results.filter((r) => r.throttled).length / results.length : 0,
    mean_relevance: relevances.length > 0 ? mean(relevances) : null,
    mean_distinctiveness: distinctivenesses.length > 0 ? mean(distinctivenesses) : null,
    mean_name_uniqueness: uniquenesses.length > 0 ? mean(uniquenesses) : null,
    // Throttled runs are excluded from latency percentiles (TRD.md §9) — a pacing wait isn't
    // the app's own latency.
    latency_ms_p50: percentile(
      nonNull(results.filter((r) => !r.throttled).map((r) => r.latency_ms)),
      50,
    ),
    latency_ms_p95: percentile(
      nonNull(results.filter((r) => !r.throttled).map((r) => r.latency_ms)),
      95,
    ),
    first_event_ms_p50: percentile(firstEventTimes, 50),
    mean_tokens: {
      input: mean(results.map((r) => r.input_tokens)),
      output: mean(results.map((r) => r.output_tokens)),
      thinking: mean(results.map((r) => r.thinking_tokens)),
    },
  };
}

// Groups a metric's non-null values by case_id, averaging each case's repeats into one value —
// the "paired by fixture case" unit D18 compares (repeats reduce noise within a case; the
// comparison itself is across cases, not across repeats).
function perCaseMeans(results: readonly EvalResultRow[], metric: (row: EvalResultRow) => number | null): Map<string, number> {
  const byCase = new Map<string, number[]>();
  for (const row of results) {
    const value = metric(row);
    if (value === null) continue;
    const values = byCase.get(row.case_id) ?? [];
    values.push(value);
    byCase.set(row.case_id, values);
  }
  const means = new Map<string, number>();
  for (const [caseId, values] of byCase) means.set(caseId, mean(values));
  return means;
}

// Only case ids present (with a non-null metric value) in *both* runs can be paired — if the
// fixture changed between baseline and candidate, or a case had no successful outcome to score
// on one side, it's dropped from that metric's comparison rather than pairing mismatched cases.
function pairedValues(baseline: Map<string, number>, candidate: Map<string, number>): { baselineValues: number[]; candidateValues: number[] } {
  const baselineValues: number[] = [];
  const candidateValues: number[] = [];
  for (const [caseId, baselineValue] of baseline) {
    const candidateValue = candidate.get(caseId);
    if (candidateValue === undefined) continue;
    baselineValues.push(baselineValue);
    candidateValues.push(candidateValue);
  }
  return { baselineValues, candidateValues };
}

export function compareEvalRuns(baselineEvalRunId: string, baselineResults: readonly EvalResultRow[], candidateResults: readonly EvalResultRow[]): EvalComparison {
  const compare = (metric: (row: EvalResultRow) => number | null, options: { minEffect: number; relative?: boolean }) => {
    const { baselineValues, candidateValues } = pairedValues(perCaseMeans(baselineResults, metric), perCaseMeans(candidateResults, metric));
    return compareMetric(baselineValues, candidateValues, options);
  };

  return {
    baseline_eval_run_id: baselineEvalRunId,
    relevance: compare((r) => r.relevance_score, { minEffect: 0.05 }),
    distinctiveness: compare((r) => r.distinctiveness_score, { minEffect: 0.05 }),
    outcome_match_rate: compare((r) => (r.outcome_match ? 1 : 0), { minEffect: 0.05 }),
    latency_ms: compare((r) => r.latency_ms, { minEffect: 0.1, relative: true }),
  };
}
