-- lib/eval/runner.ts creates an eval_runs row before the first case is called, but
-- prompt_versions/models are only known once the first GenerateResult comes back (TRD.md §4:
-- "from the first case's GenerateResult.meta") — so, like runs.prompt_versions, they start
-- empty and are filled in once known, rather than being required at insert time.
alter table eval_runs alter column prompt_versions set default '{}'::jsonb;
alter table eval_runs alter column models set default '{}'::jsonb;
