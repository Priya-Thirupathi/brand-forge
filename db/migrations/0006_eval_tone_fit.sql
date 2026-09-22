-- Stage 5, item 2's eval half (D31). Consistency cases generate a second product for a brand an
-- earlier case created, and are scored on whether the copy actually reads in that brand's fixed
-- voice — a dimension the existing relevance/distinctiveness pair can't express, since D29
-- guarantees the tone_notes *field* matches by construction and says nothing about the prose.
-- Null for every ordinary single-idea case, which is why this is nullable rather than defaulted.
alter table eval_results add column tone_fit_score numeric(3, 2);
alter table eval_results add column tone_fit_reason text;
