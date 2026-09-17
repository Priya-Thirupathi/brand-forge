-- Stage 2 schema. See TRD.md §4/§9 for rationale. Same conventions as 0001_init.sql.

create table eval_runs (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  git_sha text not null,
  target text not null,
  fixture_version text not null,
  prompt_versions jsonb not null,
  models jsonb not null,
  repeats int not null,
  is_baseline bool not null default false,
  aggregate jsonb,
  comparison jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint eval_runs_repeats_positive check (repeats > 0)
);
-- Baselines are looked up by label/target; not unique across labels, since a run may be
-- promoted to baseline after the fact (`--set-baseline` on an existing eval_runs row).
create index eval_runs_is_baseline_idx on eval_runs (is_baseline, created_at desc);
alter table eval_runs enable row level security;

create table eval_results (
  id uuid primary key default gen_random_uuid(),
  eval_run_id uuid not null references eval_runs (id) on delete cascade,
  case_id text not null,
  repeat smallint not null,
  run_id uuid references runs (id),
  expected_outcome text not null,
  actual_outcome text not null,
  outcome_match bool not null,
  first_attempt_pass bool,
  quality_retries int,
  throttled bool not null default false,
  latency_ms int,
  first_event_ms int,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  thinking_tokens int not null default 0,
  relevance_score numeric(3, 2),
  distinctiveness_score numeric(3, 2),
  name_uniqueness numeric(3, 2),
  judge_reason text,
  created_at timestamptz not null default now(),
  -- One row per case × repeat per eval run — lets `--resume` upsert idempotently instead of
  -- re-running a case × repeat that already completed.
  constraint eval_results_case_repeat_unique unique (eval_run_id, case_id, repeat),
  constraint eval_results_expected_outcome_check check (expected_outcome in ('pass', 'reject', 'safe')),
  constraint eval_results_actual_outcome_check check (actual_outcome in ('pass', 'reject', 'error', 'admission_error'))
);
alter table eval_results enable row level security;

-- Traceability from a generation run back to the eval run that produced it (in addition to
-- eval_results.run_id, which is the reverse direction) — lets `runs`/`products` rows made by
-- the harness be found directly, e.g. to purge old eval data without joining eval_results.
alter table runs add column eval_run_id uuid references eval_runs (id);
create index runs_eval_run_id_idx on runs (eval_run_id) where eval_run_id is not null;
