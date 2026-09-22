import { describe, expect, it } from "vitest";
import { computeCalibration, selectForLabelling, type JudgedScore } from "@/lib/eval/calibration";
import type { LabelSheetItem } from "@/lib/contracts/eval";

function item(overrides: Partial<LabelSheetItem>): LabelSheetItem {
  return {
    case_id: "n01",
    repeat: 1,
    category: "candle",
    idea: "an idea",
    name: "Ridge",
    tagline: "t",
    description: "d",
    human_relevance: null,
    human_distinctiveness: null,
    ...overrides,
  };
}

function judged(overrides: Partial<JudgedScore>): JudgedScore {
  return { case_id: "n01", repeat: 1, relevance: 0.8, distinctiveness: 0.6, ...overrides };
}

describe("computeCalibration", () => {
  it("measures error, direction of bias, and agreement at the decision threshold", () => {
    const items = [
      item({ case_id: "n01", human_relevance: 0.6, human_distinctiveness: 0.5 }),
      item({ case_id: "n02", human_relevance: 0.4, human_distinctiveness: 0.9 }),
    ];
    const scores = [
      judged({ case_id: "n01", relevance: 0.8, distinctiveness: 0.5 }),
      judged({ case_id: "n02", relevance: 0.6, distinctiveness: 0.9 }),
    ];

    const report = computeCalibration("run-1", "judge-x", items, scores);
    expect(report.relevance.labelled).toBe(2);
    expect(report.relevance.mean_absolute_error).toBeCloseTo(0.2);
    // Judge scored 0.2 higher on both — a systematic generosity, not noise.
    expect(report.relevance.bias).toBeCloseTo(0.2);
    // n02: human 0.4 (below the 0.5 cut) vs judge 0.6 (above) — they disagree on the only
    // threshold that changes what the harness reports, so agreement is 1 of 2.
    expect(report.relevance.threshold_agreement).toBeCloseTo(0.5);
    expect(report.distinctiveness.mean_absolute_error).toBeCloseTo(0);
  });

  it("drops unlabelled items instead of treating a blank as zero", () => {
    const items = [
      item({ case_id: "n01", human_relevance: 0.8 }),
      item({ case_id: "n02", human_relevance: null }),
    ];
    const scores = [judged({ case_id: "n01", relevance: 0.8 }), judged({ case_id: "n02", relevance: 0.9 })];

    const report = computeCalibration("run-1", "judge-x", items, scores);
    // Counting the blank as 0 would report mae 0.45 and make a perfectly calibrated judge look
    // badly off, purely because someone skipped a row.
    expect(report.relevance.labelled).toBe(1);
    expect(report.relevance.mean_absolute_error).toBeCloseTo(0);
  });

  it("reports no rank correlation when the human gave every output the same score", () => {
    const items = [
      item({ case_id: "n01", human_relevance: 0.8 }),
      item({ case_id: "n02", human_relevance: 0.8 }),
    ];
    const scores = [judged({ case_id: "n01", relevance: 0.3 }), judged({ case_id: "n02", relevance: 0.9 })];

    // No variation to rank is a real outcome on a small sheet, and it is not zero correlation.
    expect(computeCalibration("run-1", "j", items, scores).relevance.rank_correlation).toBeNull();
  });
});

describe("selectForLabelling", () => {
  it("covers every case once before taking a second repeat of any", () => {
    const rows = [
      { case_id: "n01", repeat: 1 },
      { case_id: "n01", repeat: 2 },
      { case_id: "n01", repeat: 3 },
      { case_id: "n02", repeat: 1 },
      { case_id: "n02", repeat: 2 },
      { case_id: "n03", repeat: 1 },
    ];
    // Labelling 4 rows that turned out to be repeats of one case would measure the judge on a
    // fraction of the fixture's difficulty range.
    expect(selectForLabelling(rows, 4)).toEqual([
      { case_id: "n01", repeat: 1 },
      { case_id: "n02", repeat: 1 },
      { case_id: "n03", repeat: 1 },
      { case_id: "n01", repeat: 2 },
    ]);
  });

  it("is deterministic and stops when it runs out of rows", () => {
    const rows = [{ case_id: "n02", repeat: 1 }, { case_id: "n01", repeat: 1 }];
    expect(selectForLabelling(rows, 10)).toEqual([{ case_id: "n01", repeat: 1 }, { case_id: "n02", repeat: 1 }]);
  });
});
