-- Lets a run that ends in `error` be retried without redoing steps that already succeeded —
-- the new attempt gets its own run row (runs stay create-once/finish-once), linked back to the
-- run it resumed from for traceability.
alter table runs add column resumed_from_run_id uuid references runs (id);
