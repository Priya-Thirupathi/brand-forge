import type { Pool } from "pg";
import type { GenerateEvent, GenerateResult } from "@/lib/contracts/generate";
import type { EvalCase, EvalResultRow, JudgeResult, ToneFitResult } from "@/lib/contracts/eval";
import type { LlmClient } from "@/lib/services/ports";
import { readNdjsonEvents } from "@/lib/client/ndjsonReader";
import { findEvalCaseBrandId, hasEvalResult, insertEvalResult, setEvalRunMeta, type EvalRunModels } from "@/lib/adapters/postgres/evalStore";
import { FIXTURE_CASES } from "./fixture";
import { judgeBrand, judgeToneFit, resolveJudgeModel } from "./judge";
import { nameUniqueness, outcomeMatches } from "./metrics";

// TRD.md §9 "CLI"/"Quota-aware": calls the running app over HTTP as a black box (D3), one case
// × repeat at a time (concurrency 1), paced to `rpm`. Every case × repeat is persisted as it
// completes, so `--resume` (checked here via hasEvalResult, before spending any quota) can
// continue a run that was interrupted or deliberately spread across days.

export interface RunnerOptions {
  target: string;
  evalToken: string;
  evalRunId: string;
  repeats: number;
  promptVariant?: string;
  // D32: `naming=cheap,packaging=cheap`, forwarded verbatim as X-Eval-Model-Tier.
  modelTier?: string;
  rpm: number;
  pool: Pool;
  judgeClient: LlmClient;
  onEvent?: (event: RunnerEvent) => void;
  // Testability seams — default to the real fixture and the global fetch.
  fetchImpl?: typeof fetch;
  cases?: readonly EvalCase[];
  // D3's Vercel fix: bounds one call to a single serverless invocation's wall-clock budget —
  // when set, the loop stops *before* starting a case that couldn't begin until at/after this
  // deadline, rather than running the whole fixture. Omitted (the CLI's own long-lived process)
  // means run to completion, unchanged from before this option existed.
  deadlineMs?: number;
  // Seeds the rpm pacer's clock from a previous chunk's last real call — a fresh serverless
  // invocation has no in-memory memory of when that was (unlike the CLI's single process), so
  // without this a new chunk would always fire its first case immediately regardless of rpm.
  seedLastCallAt?: number;
}

export type RunnerEvent =
  | { type: "case_skipped"; caseId: string; repeat: number }
  | { type: "case_started"; caseId: string; repeat: number }
  | { type: "case_finished"; caseId: string; repeat: number; row: EvalResultRow }
  // D31: a consistency case whose `follow_up_to` case never produced a brand (it errored, was
  // rejected, or hasn't run yet). Reported rather than silently degraded into a fresh
  // generation, which would record a tone_fit for a brand nothing actually inherited.
  | { type: "case_unresolved"; caseId: string; repeat: number; followUpTo: string };

export interface RunFixtureResult {
  completed: boolean;
  // Only set when !completed: when the next not-yet-recorded case is allowed to start, per rpm
  // pacing — lets a chunked caller tell its client how long to wait before asking for more.
  nextAvailableAt?: number;
}

export async function runEvalFixture(options: RunnerOptions): Promise<RunFixtureResult> {
  const pace = createPacer(options.rpm, options.seedLastCallAt);
  const doFetch = options.fetchImpl ?? fetch;
  const cases = options.cases ?? FIXTURE_CASES;
  let metaRecorded = false;
  // D31: brand ids this process has seen, so the common case (prerequisite ran moments ago in
  // this same loop) costs no query. Misses fall back to the database — see resolveFollowUpBrand.
  const brandIdByCase = new Map<string, string>();

  for (const evalCase of cases) {
    for (let repeat = 1; repeat <= options.repeats; repeat++) {
      if (await hasEvalResult(options.pool, options.evalRunId, evalCase.id, repeat)) {
        options.onEvent?.({ type: "case_skipped", caseId: evalCase.id, repeat });
        continue;
      }

      const nextAvailableAt = pace.nextAvailableAt();
      if (options.deadlineMs !== undefined && nextAvailableAt >= options.deadlineMs) {
        return { completed: false, nextAvailableAt };
      }

      options.onEvent?.({ type: "case_started", caseId: evalCase.id, repeat });

      let followUpBrandId: string | undefined;
      if (evalCase.follow_up_to) {
        followUpBrandId = await resolveFollowUpBrand(options, brandIdByCase, evalCase.follow_up_to);
        if (!followUpBrandId) {
          // No quota is spent and no pacing slot consumed: there is nothing to generate against.
          options.onEvent?.({ type: "case_unresolved", caseId: evalCase.id, repeat, followUpTo: evalCase.follow_up_to });
          const row = buildRow(options.evalRunId, evalCase, repeat, emptyOutcome("error", false));
          await insertEvalResult(options.pool, row);
          options.onEvent?.({ type: "case_finished", caseId: evalCase.id, repeat, row });
          continue;
        }
      }

      const throttled = await pace.wait();
      const { row, resultMeta, brandId } = await runOneCase(doFetch, options, evalCase, repeat, throttled, followUpBrandId);
      await insertEvalResult(options.pool, row);
      // Only the first successful repeat's brand is remembered, matching findEvalCaseBrandId's
      // `order by repeat` — otherwise a later repeat would silently change what c01 inherits.
      if (brandId && !brandIdByCase.has(evalCase.id)) brandIdByCase.set(evalCase.id, brandId);

      if (!metaRecorded && resultMeta && Object.keys(resultMeta.models).length > 0) {
        await setEvalRunMeta(options.pool, options.evalRunId, {
          promptVersions: resultMeta.promptVersions,
          models: { ...resultMeta.models, judge: resolveJudgeModel() },
        });
        metaRecorded = true;
      }

      options.onEvent?.({ type: "case_finished", caseId: evalCase.id, repeat, row });
    }
  }
  return { completed: true };
}

async function resolveFollowUpBrand(
  options: RunnerOptions,
  brandIdByCase: Map<string, string>,
  followUpTo: string,
): Promise<string | undefined> {
  const remembered = brandIdByCase.get(followUpTo);
  if (remembered) return remembered;
  const stored = await findEvalCaseBrandId(options.pool, options.evalRunId, followUpTo);
  if (stored) brandIdByCase.set(followUpTo, stored);
  return stored ?? undefined;
}

interface CaseOutcomeData {
  runId: string | null;
  actualOutcome: EvalResultRow["actual_outcome"];
  latencyMs: number | null;
  firstEventMs: number | null;
  qualityRetries: number | null;
  tokens: { input: number; output: number; thinking: number } | null;
  judge: JudgeResult | null;
  toneFit: ToneFitResult | null;
  nameCandidates: readonly string[];
  throttled: boolean;
}

async function runOneCase(
  doFetch: typeof fetch,
  options: RunnerOptions,
  evalCase: EvalCase,
  repeat: number,
  throttled: boolean,
  followUpBrandId?: string,
): Promise<{
  row: EvalResultRow;
  resultMeta?: { promptVersions: GenerateResult["meta"]["prompt_versions"]; models: EvalRunModels };
  // The brand this case created, for a later consistency case to attach to (D31).
  brandId?: string;
}> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/x-ndjson",
    "x-eval-token": options.evalToken,
    "x-eval-run-id": options.evalRunId,
  };
  if (options.promptVariant) headers["x-eval-prompt-variant"] = options.promptVariant;
  if (options.modelTier) headers["x-eval-model-tier"] = options.modelTier;

  const startedAt = Date.now();
  const response = await doFetch(`${options.target}/api/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      idea: evalCase.idea,
      category: evalCase.category,
      ...(followUpBrandId ? { follow_up_brand_id: followUpBrandId } : {}),
    }),
  });

  // Admission itself failed (400/401/404/429/misconfigured target) — never reached a stream,
  // so there's nothing case-specific to judge or measure beyond that it didn't get in.
  if (!response.ok) {
    return { row: buildRow(options.evalRunId, evalCase, repeat, emptyOutcome("admission_error", throttled)) };
  }

  let firstEventMs: number | null = null;
  let result: GenerateResult | undefined;
  let errorEvent: Extract<GenerateEvent, { type: "error" }> | undefined;
  await readNdjsonEvents(response, (event) => {
    if (firstEventMs === null) firstEventMs = Date.now() - startedAt;
    if (event.type === "result") result = event.result;
    if (event.type === "error") errorEvent = event;
  });

  if (result) {
    const actualOutcome: EvalResultRow["actual_outcome"] = result.status === "succeeded" ? "pass" : "reject";
    const nameCandidates = result.name_candidates?.map((c) => c.name) ?? [];

    let judge: JudgeResult | null = null;
    let toneFit: ToneFitResult | null = null;
    if (actualOutcome === "pass" && result.brand && result.product) {
      const outcome = await judgeBrand(
        options.judgeClient,
        { idea: evalCase.idea, category: evalCase.category, name: result.brand.name, tagline: result.product.tagline, description: result.product.description },
        Date.now() + 15_000,
      );
      if (outcome.kind === "ok") judge = outcome.result;

      // D31: only a follow-up has an inherited voice to be consistent with. A second judge
      // call, so this costs nothing on the 20 ordinary cases.
      if (followUpBrandId) {
        const toneOutcome = await judgeToneFit(
          options.judgeClient,
          {
            toneNotes: result.brand.tone_notes,
            name: result.brand.name,
            tagline: result.product.tagline,
            description: result.product.description,
          },
          Date.now() + 15_000,
        );
        if (toneOutcome.kind === "ok") toneFit = toneOutcome.result;
      }
    }

    const row = buildRow(options.evalRunId, evalCase, repeat, {
      runId: result.run_id,
      actualOutcome,
      latencyMs: result.meta.latency_ms,
      firstEventMs,
      qualityRetries: result.guardrails.quality_retries,
      tokens: result.meta.tokens,
      judge,
      toneFit,
      nameCandidates,
      throttled,
    });
    return { row, resultMeta: { promptVersions: result.meta.prompt_versions, models: result.meta.models }, brandId: result.brand?.id };
  }

  // A genuine run-level error (TRD.md §5 always ends the stream with `result` or `error`) —
  // if somehow neither arrived, this still records an honest "error" row instead of hanging.
  return {
    row: buildRow(options.evalRunId, evalCase, repeat, {
      runId: errorEvent?.run_id || null,
      actualOutcome: "error",
      latencyMs: null,
      firstEventMs,
      qualityRetries: null,
      tokens: null,
      judge: null,
      toneFit: null,
      nameCandidates: [],
      throttled,
    }),
  };
}

function emptyOutcome(actualOutcome: EvalResultRow["actual_outcome"], throttled: boolean): CaseOutcomeData {
  return { runId: null, actualOutcome, latencyMs: null, firstEventMs: null, qualityRetries: null, tokens: null, judge: null, toneFit: null, nameCandidates: [], throttled };
}

function buildRow(evalRunId: string, evalCase: EvalCase, repeat: number, data: CaseOutcomeData): EvalResultRow {
  const relevance = data.judge?.relevance ?? null;
  // D31: a follow-up skips naming entirely, so its "name" was produced by the case it inherits
  // from. Scoring distinctiveness on it would count that one name twice across the fixture and
  // pollute the metric M4's sensitivity proof depends on. Relevance still applies — the copy is
  // genuinely about *this* case's idea.
  const isFollowUp = evalCase.follow_up_to !== undefined;
  return {
    eval_run_id: evalRunId,
    case_id: evalCase.id,
    repeat,
    run_id: data.runId,
    expected_outcome: evalCase.expected_outcome,
    actual_outcome: data.actualOutcome,
    outcome_match: outcomeMatches(evalCase.expected_outcome, data.actualOutcome, relevance),
    first_attempt_pass: data.actualOutcome === "pass" ? data.qualityRetries === 0 : null,
    quality_retries: data.qualityRetries,
    throttled: data.throttled,
    latency_ms: data.latencyMs,
    first_event_ms: data.firstEventMs,
    input_tokens: data.tokens?.input ?? 0,
    output_tokens: data.tokens?.output ?? 0,
    thinking_tokens: data.tokens?.thinking ?? 0,
    relevance_score: relevance,
    distinctiveness_score: isFollowUp ? null : (data.judge?.distinctiveness ?? null),
    name_uniqueness: isFollowUp ? null : nameUniqueness(data.nameCandidates),
    judge_reason: data.judge?.reason ?? null,
    tone_fit_score: data.toneFit?.tone_fit ?? null,
    tone_fit_reason: data.toneFit?.reason ?? null,
  };
}

interface Pacer {
  // When the next not-yet-made call is allowed to fire, without waiting for it.
  nextAvailableAt(): number;
  // Waits if needed, then commits to a call now. `throttled` reports whether it had to wait.
  wait(): Promise<boolean>;
}

// RPM pacing, concurrency 1 (TRD.md §9): waits before a call only when the previous call was
// less than a full interval ago. `seedLastCallAt` lets a chunked caller (D3) carry the clock
// across separate process invocations instead of restarting it at zero each time.
function createPacer(rpm: number, seedLastCallAt?: number): Pacer {
  const minIntervalMs = 60_000 / rpm;
  let lastCallAt = seedLastCallAt ?? 0;
  return {
    nextAvailableAt() {
      return lastCallAt === 0 ? Date.now() : lastCallAt + minIntervalMs;
    },
    async wait() {
      const now = Date.now();
      const elapsed = lastCallAt === 0 ? Infinity : now - lastCallAt;
      const throttled = elapsed < minIntervalMs;
      if (throttled) {
        await new Promise((resolve) => setTimeout(resolve, minIntervalMs - elapsed));
      }
      lastCallAt = Date.now();
      return throttled;
    },
  };
}
