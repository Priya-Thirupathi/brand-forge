import type { CalibrationDimension, CalibrationReport, LabelSheetItem } from "@/lib/contracts/eval";
import { spearman } from "./stats";

// D33, Stage 5 item 5: audits the LLM judge against human labels. The judge is the one part of
// the harness nothing else checks — every other number is deterministic, but relevance and
// distinctiveness are one model's opinion of another model's output, and PRD.md §9 lists
// "LLM judge bias (the provider judging its own output)" as a known risk. This is what turns
// that risk from acknowledged into measured.

export interface JudgedScore {
  case_id: string;
  repeat: number;
  relevance: number | null;
  distinctiveness: number | null;
}

// The operational cut: outcomeMatches (lib/eval/metrics.ts) treats a "safe" case as matching
// when the judge scored relevance >= 0.5. Agreement here is the only threshold number that
// changes what the harness actually reports.
const DECISION_THRESHOLD = 0.5;

function dimension(pairs: readonly { human: number; judge: number }[]): CalibrationDimension {
  if (pairs.length === 0) {
    return { labelled: 0, mean_absolute_error: 0, bias: 0, rank_correlation: null, threshold_agreement: 0 };
  }
  const errors = pairs.map((p) => p.judge - p.human);
  return {
    labelled: pairs.length,
    mean_absolute_error: errors.reduce((sum, e) => sum + Math.abs(e), 0) / pairs.length,
    bias: errors.reduce((sum, e) => sum + e, 0) / pairs.length,
    rank_correlation: spearman(
      pairs.map((p) => p.human),
      pairs.map((p) => p.judge),
    ),
    threshold_agreement:
      pairs.filter((p) => p.human >= DECISION_THRESHOLD === p.judge >= DECISION_THRESHOLD).length / pairs.length,
  };
}

// Joins a filled-in sheet to the judge's own stored scores on case_id + repeat. An item the
// human left blank, or one whose judge score is missing, is dropped from that dimension rather
// than defaulted — a skipped label is not a zero, and averaging one in would quietly move every
// number in the report.
export function computeCalibration(
  evalRunId: string,
  judgeModel: string,
  items: readonly LabelSheetItem[],
  judged: readonly JudgedScore[],
): CalibrationReport {
  const judgedByKey = new Map(judged.map((j) => [`${j.case_id}#${j.repeat}`, j]));

  const collect = (
    human: (item: LabelSheetItem) => number | null,
    judge: (score: JudgedScore) => number | null,
  ): { human: number; judge: number }[] => {
    const pairs: { human: number; judge: number }[] = [];
    for (const item of items) {
      const humanValue = human(item);
      const score = judgedByKey.get(`${item.case_id}#${item.repeat}`);
      const judgeValue = score ? judge(score) : null;
      if (humanValue === null || judgeValue === null) continue;
      pairs.push({ human: humanValue, judge: judgeValue });
    }
    return pairs;
  };

  return {
    eval_run_id: evalRunId,
    judge_model: judgeModel,
    relevance: dimension(collect((i) => i.human_relevance, (j) => j.relevance)),
    distinctiveness: dimension(collect((i) => i.human_distinctiveness, (j) => j.distinctiveness)),
  };
}

// Picks which outputs to label, deterministically: one repeat per case first, in case order,
// then further repeats only once every case has been covered. Labelling 20 rows that turn out
// to be three repeats of the same seven cases would measure the judge on a fraction of the
// fixture's difficulty range and call it a calibration.
export function selectForLabelling<T extends { case_id: string; repeat: number }>(rows: readonly T[], limit: number): T[] {
  const byCase = new Map<string, T[]>();
  for (const row of [...rows].sort((a, b) => a.case_id.localeCompare(b.case_id) || a.repeat - b.repeat)) {
    const list = byCase.get(row.case_id) ?? [];
    list.push(row);
    byCase.set(row.case_id, list);
  }

  const selected: T[] = [];
  for (let round = 0; selected.length < limit; round++) {
    let addedThisRound = false;
    for (const list of byCase.values()) {
      if (selected.length >= limit) break;
      if (list.length > round) {
        selected.push(list[round]);
        addedThisRound = true;
      }
    }
    if (!addedThisRound) break;
  }
  return selected;
}
