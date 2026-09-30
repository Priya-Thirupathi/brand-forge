-- The per-IP generation limit is gone (D16 revised), so the hashed client IP it was counted by
-- has no remaining reader. Dropping the column is the whole privacy story: there is no longer
-- any personal data to salt, scrub or retain, and the Generate tab's disclosure loses the
-- sentence about it. The global rolling-24h cap is now the only admission control.
drop index runs_client_ip_hash_created_at_idx;
alter table runs drop column client_ip_hash;

-- The global cap now counts runs of every source (eval runs spend the same provider quota),
-- so its query predicate is bare `created_at >= $1`. The surviving runs_source_created_at_idx
-- leads with `source` and can't serve that, and the index just dropped was the only other one
-- covering created_at — without this, every admitted generation triggers a sequential scan.
create index runs_created_at_idx on runs (created_at);
