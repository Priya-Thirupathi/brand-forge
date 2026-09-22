import type { Pool } from "pg";
import type { StepName } from "@/lib/contracts/stepName";
import type { EvalAggregate, EvalComparison, EvalResultRow, EvalRunSummary } from "@/lib/contracts/eval";

// TRD.md §4/§9 (Stage 2). Mirrors lib/adapters/postgres/generationStore.ts's conventions
// (explicit JSON.stringify for jsonb — pg serializes a JS array as a Postgres array literal,
// not JSON, so binding an object/array directly would be silently wrong).

export interface NewEvalRun {
  label: string;
  gitSha: string;
  target: string;
  fixtureVersion: string;
  repeats: number;
}

export type EvalRunModels = Partial<Record<StepName, string>> & { judge?: string };

// `POST /api/generate`'s `X-Eval-Run-Id` must reference a row created here first (TRD.md §8) —
// the CLI always calls this before its first case. `prompt_versions`/`models` aren't known yet
// (they come from the first case's GenerateResult.meta) — left at their '{}'::jsonb default
// (migration 0004) and filled in by setEvalRunMeta once the first result arrives.
export async function createEvalRun(pool: Pool, run: NewEvalRun): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into eval_runs (label, git_sha, target, fixture_version, repeats)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [run.label, run.gitSha, run.target, run.fixtureVersion, run.repeats],
  );
  return rows[0].id;
}

// Filled in once, from the first case's GenerateResult — a no-op if called again (TRD.md §4).
export async function setEvalRunMeta(pool: Pool, id: string, meta: { promptVersions: Partial<Record<StepName, string>>; models: EvalRunModels }): Promise<void> {
  await pool.query(`update eval_runs set prompt_versions = $2::jsonb, models = $3::jsonb where id = $1`, [id, JSON.stringify(meta.promptVersions), JSON.stringify(meta.models)]);
}

export async function evalRunExists(pool: Pool, id: string): Promise<boolean> {
  const { rows } = await pool.query("select 1 from eval_runs where id = $1", [id]);
  return rows.length > 0;
}

// `--resume` (TRD.md §9) calls this before spending quota on a case × repeat, so a prior
// partial run never re-does work that already completed.
export async function hasEvalResult(pool: Pool, evalRunId: string, caseId: string, repeat: number): Promise<boolean> {
  const { rows } = await pool.query("select 1 from eval_results where eval_run_id = $1 and case_id = $2 and repeat = $3", [evalRunId, caseId, repeat]);
  return rows.length > 0;
}

export async function insertEvalResult(pool: Pool, row: EvalResultRow): Promise<void> {
  await pool.query(
    `insert into eval_results (
       eval_run_id, case_id, repeat, run_id, expected_outcome, actual_outcome, outcome_match,
       first_attempt_pass, quality_retries, throttled, latency_ms, first_event_ms,
       input_tokens, output_tokens, thinking_tokens,
       relevance_score, distinctiveness_score, name_uniqueness, judge_reason,
       tone_fit_score, tone_fit_reason
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
     on conflict (eval_run_id, case_id, repeat) do nothing`,
    [
      row.eval_run_id,
      row.case_id,
      row.repeat,
      row.run_id,
      row.expected_outcome,
      row.actual_outcome,
      row.outcome_match,
      row.first_attempt_pass,
      row.quality_retries,
      row.throttled,
      row.latency_ms,
      row.first_event_ms,
      row.input_tokens,
      row.output_tokens,
      row.thinking_tokens,
      row.relevance_score,
      row.distinctiveness_score,
      row.name_uniqueness,
      row.judge_reason,
      row.tone_fit_score,
      row.tone_fit_reason,
    ],
  );
}

export async function countEvalResults(pool: Pool, evalRunId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>("select count(*) from eval_results where eval_run_id = $1", [evalRunId]);
  return Number(rows[0].count);
}

// D3's chunked-run fix (POST /api/eval/run): a fresh serverless invocation has no in-memory
// record of when the last case actually fired, so the rpm pacer is seeded from this instead.
export async function getLastResultTimestamp(pool: Pool, evalRunId: string): Promise<Date | null> {
  const { rows } = await pool.query<{ created_at: Date }>("select created_at from eval_results where eval_run_id = $1 order by created_at desc limit 1", [evalRunId]);
  return rows[0]?.created_at ?? null;
}

export async function listEvalResults(pool: Pool, evalRunId: string): Promise<EvalResultRow[]> {
  const { rows } = await pool.query(
    `select eval_run_id, case_id, repeat, run_id, expected_outcome, actual_outcome, outcome_match,
            first_attempt_pass, quality_retries, throttled, latency_ms, first_event_ms,
            input_tokens, output_tokens, thinking_tokens,
            relevance_score::float8, distinctiveness_score::float8, name_uniqueness::float8, judge_reason,
            tone_fit_score::float8, tone_fit_reason
     from eval_results where eval_run_id = $1 order by case_id, repeat`,
    [evalRunId],
  );
  return rows;
}

export async function finishEvalRun(pool: Pool, id: string, aggregate: EvalAggregate): Promise<void> {
  await pool.query(`update eval_runs set finished_at = now(), aggregate = $2::jsonb where id = $1`, [id, JSON.stringify(aggregate)]);
}

export async function setEvalRunComparison(pool: Pool, id: string, comparison: EvalComparison): Promise<void> {
  await pool.query(`update eval_runs set comparison = $2::jsonb where id = $1`, [id, JSON.stringify(comparison)]);
}

export async function setBaseline(pool: Pool, id: string): Promise<void> {
  await pool.query(`update eval_runs set is_baseline = true where id = $1`, [id]);
}

interface EvalRunRow {
  id: string;
  label: string;
  git_sha: string;
  target: string;
  fixture_version: string;
  prompt_versions: Partial<Record<StepName, string>>;
  models: EvalRunModels;
  repeats: number;
  is_baseline: boolean;
  // Typed as the shape actually on disk, which for any run predating D31 has no tone-fit
  // fields. Claiming `EvalAggregate` here would let the missing ones reach the client as
  // `undefined` behind a type that promises otherwise; listStoredRuns fills them instead.
  aggregate: StoredAggregate | null;
  comparison: StoredComparison | null;
  created_at: Date;
  finished_at: Date | null;
}

type StoredAggregate = Omit<EvalAggregate, "mean_tone_fit"> & Partial<Pick<EvalAggregate, "mean_tone_fit">>;
type StoredComparison = Omit<EvalComparison, "tone_fit"> & Partial<Pick<EvalComparison, "tone_fit">>;

const EVAL_RUN_COLUMNS = `id, label, git_sha, target, fixture_version, prompt_versions, models, repeats, is_baseline, aggregate, comparison, created_at, finished_at`;

export async function getEvalRun(pool: Pool, id: string): Promise<EvalRunRow | null> {
  const { rows } = await pool.query<EvalRunRow>(`select ${EVAL_RUN_COLUMNS} from eval_runs where id = $1`, [id]);
  return rows[0] ?? null;
}

// The most recently created row still flagged `is_baseline` — a label may be promoted to
// baseline more than once over time (TRD.md §4), so this is "latest", not "only".
export async function getLatestBaseline(pool: Pool): Promise<EvalRunRow | null> {
  const { rows } = await pool.query<EvalRunRow>(`select ${EVAL_RUN_COLUMNS} from eval_runs where is_baseline order by created_at desc limit 1`);
  return rows[0] ?? null;
}

// GET /api/eval/summary (TRD.md §8) — never eval_results detail.
export async function listEvalRunSummaries(pool: Pool, params: { label?: string; limit: number }): Promise<EvalRunSummary[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (params.label) {
    values.push(params.label);
    conditions.push(`label = $${values.length}`);
  }
  values.push(params.limit);

  const { rows } = await pool.query<EvalRunRow & { completed_case_repeats: string }>(
    `select ${EVAL_RUN_COLUMNS},
            (select count(*) from eval_results er where er.eval_run_id = eval_runs.id) as completed_case_repeats
     from eval_runs
     ${conditions.length > 0 ? `where ${conditions.join(" and ")}` : ""}
     order by created_at desc
     limit $${values.length}`,
    values,
  );

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    git_sha: row.git_sha,
    created_at: row.created_at.toISOString(),
    finished_at: row.finished_at?.toISOString() ?? null,
    is_baseline: row.is_baseline,
    repeats: row.repeats,
    completed_case_repeats: Number(row.completed_case_repeats),
    // D31 added mean_tone_fit/comparison.tone_fit after runs had already been stored. Nothing
    // Zod-parses this jsonb on the way out, so an aggregate written before then would otherwise
    // reach the client missing a field the contract says is always present. Defaulting here —
    // at the one boundary where stored shape becomes contract shape — keeps the type honest
    // without rewriting historical rows, which would falsify what those runs actually measured.
    aggregate: row.aggregate ? { ...row.aggregate, mean_tone_fit: row.aggregate.mean_tone_fit ?? null } : null,
    comparison: row.comparison ? { ...row.comparison, tone_fit: row.comparison.tone_fit ?? null } : null,
  }));
}

// D31: which brand a consistency case should attach its follow-up to — the brand created by an
// *earlier* case in this same eval run. Read from the database rather than kept only in memory
// because `--resume` and D3's serverless chunking both mean the prerequisite case may have run
// in a different process entirely. Ordered by repeat so a case with several successful repeats
// resolves to the same brand every time, rather than whichever row the planner returned first.
export async function findEvalCaseBrandId(pool: Pool, evalRunId: string, caseId: string): Promise<string | null> {
  const { rows } = await pool.query<{ brand_id: string }>(
    `select p.brand_id
     from eval_results er
     join products p on p.run_id = er.run_id
     where er.eval_run_id = $1 and er.case_id = $2 and er.actual_outcome = 'pass'
     order by er.repeat
     limit 1`,
    [evalRunId, caseId],
  );
  return rows[0]?.brand_id ?? null;
}

export interface JudgedOutput {
  case_id: string;
  repeat: number;
  category: string;
  idea: string;
  name: string;
  tagline: string;
  description: string;
  relevance: number | null;
  distinctiveness: number | null;
}

// D33: the succeeded outputs of one eval run, with the copy a human would need to label them.
// eval_results stores only scores and a run_id, so the words themselves come back through
// products/brands. Ordered deterministically so two exports of the same run produce the same
// sheet, which matters when a labelling session is spread over more than one sitting.
export async function listJudgedOutputs(pool: Pool, evalRunId: string): Promise<JudgedOutput[]> {
  const { rows } = await pool.query<JudgedOutput>(
    `select er.case_id, er.repeat, p.category, p.idea, b.name, p.tagline, p.description,
            er.relevance_score::float8 as relevance, er.distinctiveness_score::float8 as distinctiveness
     from eval_results er
     join products p on p.run_id = er.run_id
     join brands b on b.id = p.brand_id
     where er.eval_run_id = $1 and er.actual_outcome = 'pass'
     order by er.case_id, er.repeat`,
    [evalRunId],
  );
  return rows;
}
