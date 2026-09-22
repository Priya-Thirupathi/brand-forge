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

// D33: Spearman rank correlation — Pearson applied to ranks. Used instead of raw Pearson
// because judge and human scores are subjective ordinal judgements on a 0-1 scale, where "did
// they order these outputs the same way" is a fairer question than "did they pick the same
// numbers". Null when either side has no variation to rank (every value identical), which is a
// real outcome on a small label set and not a zero correlation.
export function spearman(a: readonly number[], b: readonly number[]): number | null {
  if (a.length !== b.length || a.length < 2) return null;
  const rankA = toRanks(a);
  const rankB = toRanks(b);
  const meanA = mean(rankA);
  const meanB = mean(rankB);

  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < rankA.length; i++) {
    const da = rankA[i] - meanA;
    const db = rankB[i] - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  if (varianceA === 0 || varianceB === 0) return null;
  return covariance / Math.sqrt(varianceA * varianceB);
}

// Average ranks for ties, so repeated scores (common when a judge leans on round numbers like
// 0.8) don't get an arbitrary order imposed on them.
function toRanks(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index })).sort((x, y) => x.value - y.value);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].value === indexed[i].value) j++;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].index] = averageRank;
    i = j + 1;
  }
  return ranks;
}
