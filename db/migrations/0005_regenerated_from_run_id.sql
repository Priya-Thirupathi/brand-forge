-- Stage 5, item 3 (D30): picking an alternate name candidate regenerates the copy around it.
-- Like a resume, the new attempt gets its own run row and links back to where it came from —
-- but it is deliberately a separate column, not a reuse of resumed_from_run_id: a resume
-- retries a run that *errored*, a regenerate branches off one that *succeeded*, and the Runs
-- tab would otherwise report every regenerate as a failure retry.
alter table runs add column regenerated_from_run_id uuid references runs (id);
