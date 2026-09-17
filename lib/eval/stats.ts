import type { MetricDelta } from "@/lib/contracts/eval";

// D18: paired bootstrap confidence intervals. Comparison is paired by fixture case (repeats
// within a case are averaged into one value per case first — see compareMetric), because
// difficulty varies far more between cases than between prompt/model versions, and pairing
// removes that between-case variance instead of drowning in it.

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// 10,000 resamples of the per-case paired differences, 95% CI from the resampled means'
// 2.5th/97.5th percentiles. No distributional assumption on the 0-1 scores (unlike a t-test).
export function bootstrapCI(diffs: readonly number[], resamples = 10_000): { ciLow: number; ciHigh: number } {
  if (diffs.length === 0) return { ciLow: 0, ciHigh: 0 };
  if (diffs.length === 1) return { ciLow: diffs[0], ciHigh: diffs[0] };

  const resampledMeans: number[] = new Array(resamples);
  for (let i = 0; i < resamples; i++) {
    let sum = 0;
    for (let j = 0; j < diffs.length; j++) {
      sum += diffs[Math.floor(Math.random() * diffs.length)];
    }
    resampledMeans[i] = sum / diffs.length;
  }
  resampledMeans.sort((a, b) => a - b);

  const lowIndex = Math.floor(0.025 * resamples);
  const highIndex = Math.min(resamples - 1, Math.ceil(0.975 * resamples) - 1);
  return { ciLow: resampledMeans[lowIndex], ciHigh: resampledMeans[highIndex] };
}

export interface CompareMetricOptions {
  // Absolute units by default (0.05 for a 0-1 score, TRD.md §9); pass `relative: true` for
  // latency's "≥ 10%" threshold, which is 10% of the baseline mean, not 10 raw milliseconds.
  minEffect: number;
  relative?: boolean;
}

// `baselineByCase`/`candidateByCase` must be the same length, one value per fixture case
// (already averaged across that case's repeats) and in the same case order — the pairing
// D18 relies on. Throws on a length mismatch or empty input rather than silently comparing
// misaligned cases.
export function compareMetric(baselineByCase: readonly number[], candidateByCase: readonly number[], options: CompareMetricOptions): MetricDelta {
  if (baselineByCase.length !== candidateByCase.length || baselineByCase.length === 0) {
    throw new Error("compareMetric requires equal-length, non-empty paired per-case arrays");
  }

  const diffs = candidateByCase.map((value, i) => value - baselineByCase[i]);
  const baselineMean = mean(baselineByCase);
  const candidateMean = mean(candidateByCase);
  const delta = candidateMean - baselineMean;
  const { ciLow, ciHigh } = bootstrapCI(diffs);

  const threshold = options.relative ? Math.abs(baselineMean) * options.minEffect : options.minEffect;
  const ciExcludesZero = ciLow > 0 || ciHigh < 0;

  return {
    baseline_mean: baselineMean,
    candidate_mean: candidateMean,
    delta,
    ci_low: ciLow,
    ci_high: ciHigh,
    flagged: ciExcludesZero && Math.abs(delta) >= threshold,
  };
}
