import { z } from "zod";
import type { StepName } from "@/lib/contracts/stepName";
import type { Violation } from "@/lib/contracts/violation";
import type { CategoryFacts, FeasibilityOptionFacts } from "@/lib/domain/types";
import type { AgentSpec } from "@/lib/domain/agents/types";
import { namingAgent, type NamingAccepted, type NamingInput, type NamingOutput } from "@/lib/domain/agents/naming";
import { taglineDescriptionAgent, type TaglineDescriptionOutput, type ToneNotes } from "@/lib/domain/agents/taglineDescription";
import { packagingAgent } from "@/lib/domain/agents/packaging";
import { renderTemplate } from "@/lib/domain/prompts/render";
import { renderRetryFeedback } from "@/lib/domain/prompts/retryFeedback";
import { checkBannedWordInIdea } from "@/lib/domain/guardrails/inputRules";
import { buildRejectedOutcome, buildSucceededOutcome, type GenerationOutcome } from "@/lib/domain/result";
import { resolveModel } from "@/config/routing";
import type { ModelTier } from "@/lib/contracts/eval";
import type {
  Clock,
  ErrorFailure,
  FinishedRunIds,
  GenerationStore,
  LlmClient,
  LlmOutcome,
  NameCandidateRecord,
  RejectedFailure,
  RunStepRecord,
  TokenUsage,
  TransportFailureReason,
} from "./ports";

// TRD.md §5 "Timeouts and retries".
export const RUN_DEADLINE_MS = 25_000;

export type RunProgressEvent =
  | { type: "run_started"; runId: string }
  | { type: "step_started"; step: StepName }
  | { type: "step_finished"; step: StepName; attempt: 1 | 2; passed: boolean };

export interface RunGenerationInput {
  idea: string;
  category: CategoryFacts;
  // The store row id (TRD.md §4 products.feasibility_option_id) — kept separate from `option`
  // because FeasibilityOptionFacts is deliberately the trimmed, prompt-safe projection with no
  // id (lib/domain/types.ts).
  feasibilityOptionId: string;
  option: FeasibilityOptionFacts;
  source: "user" | "eval";
  clientIpHash: string;
  // Resuming a run that previously failed after at least one step succeeded — steps present
  // here are skipped entirely (no LLM call, no new run_steps row), reusing the already-accepted
  // value straight from lib/adapters/postgres/resume.ts's replay of the old run's raw_output.
  // `resumedFromRunId` is bookkeeping only (persisted on the new run row); `resume` is what
  // actually changes this function's behavior — they're expected together, but only `resume`'s
  // presence matters here.
  resumedFromRunId?: string;
  resume?: {
    naming?: NamingAccepted;
    taglineDescription?: TaglineDescriptionOutput;
  };
  // Stage 5, item 2 (D29): a new product for an already-existing, already-named brand — naming
  // is skipped the same way `resume.naming` skips it (no LLM call, no candidates), and
  // tagline_description is constrained to this brand's existing tone instead of inventing one.
  // Never set together with `resume` in practice (different flows never reachable at once from
  // the UI), but nothing here enforces that — both would simply skip naming redundantly.
  followUpBrand?: { id: string; name: string; toneNotes: ToneNotes };
  // Stage 5, item 3 (D30): the user picked one of an earlier run's other name candidates, so
  // naming is skipped and the rest of the copy is generated around that name — a fresh brand
  // with a fresh tone, deliberately the opposite of `followUpBrand`. The origin run id and the
  // accepted naming value are one field rather than the pair `resume` uses, because unlike a
  // resume there is no meaningful half-state: lib/adapters/postgres/regenerate.ts either
  // validated the name against that run's candidates or the request was refused outright.
  regenerate?: { fromRunId: string; naming: NamingAccepted };
  // Present only on `source: "eval"` runs — see NewRun.evalRunId.
  evalRunId?: string;
  // D32, Stage 5 item 4: moves one or more steps to the other model tier for this run only,
  // set from `X-Eval-Model-Tier`. Eval-sourced runs only — a user run always uses the committed
  // STEP_TIER map, so the experiment can never change what the live demo actually does.
  modelTierOverride?: Partial<Record<StepName, ModelTier>>;
  // Stage 2 sensitivity proof (TRD.md §9): swaps in an alternate naming prompt for this run
  // only, selected via `X-Eval-Prompt-Variant: naming=degraded`. Absent on every user-sourced
  // and ordinary eval run.
  namingAgentOverride?: AgentSpec<NamingInput, NamingOutput, NamingAccepted>;
}

export interface RunGenerationDeps {
  llmClient: LlmClient;
  store: GenerationStore;
  clock?: Clock;
}

export interface RunGenerationOptions {
  // A client disconnect cancels in-flight calls (TRD.md §5).
  signal?: AbortSignal;
  onEvent?: (event: RunProgressEvent) => void;
}

export interface RunErrorOutcome {
  status: "error";
  step: StepName;
  error: TransportFailureReason;
  message: string;
  qualityRetries: number;
}

// Everything TRD.md §8's GenerateResult.meta needs that GenerationOutcome (domain, no notion of
// models/prompt hashes/timing) doesn't carry — the route handler shapes this straight into
// `meta` without recomputing it from `steps`, which stays store-only (RunStepRecord.rawOutput
// is never exposed via the API).
export interface RunMeta {
  models: Partial<Record<StepName, string>>;
  promptVersions: Partial<Record<StepName, string>>;
  latencyMs: number;
  transportRetries: number;
  usage: TokenUsage;
}

export interface RunResult {
  runId: string;
  outcome: GenerationOutcome | RunErrorOutcome;
  meta: RunMeta;
  // Only a succeeded run creates a brand/product row (GenerationStore.finishRun).
  ids?: FinishedRunIds;
}

export async function runGeneration(
  input: RunGenerationInput,
  deps: RunGenerationDeps,
  options: RunGenerationOptions = {},
): Promise<RunResult> {
  const clock = deps.clock ?? { now: () => Date.now() };
  const startedAt = clock.now();
  const deadlineAt = startedAt + RUN_DEADLINE_MS;

  const runId = await deps.store.startRun({
    source: input.source,
    idea: input.idea,
    category: input.category.slug,
    feasibilityOptionId: input.feasibilityOptionId,
    clientIpHash: input.clientIpHash,
    resumedFromRunId: input.resumedFromRunId,
    regeneratedFromRunId: input.regenerate?.fromRunId,
    evalRunId: input.evalRunId,
  });
  options.onEvent?.({ type: "run_started", runId });

  const records: RunStepRecord[] = [];
  const promptVersions: Partial<Record<StepName, string>> = {};
  let qualityRetries = 0;

  // input.banned_word (TRD.md §7) — checked once, before any generation call is spent on it.
  const bannedWordViolations = checkBannedWordInIdea(input.idea);
  if (bannedWordViolations.length > 0) {
    return finish(deps.store, clock, startedAt, runId, input.option, qualityRetries, records, promptVersions, undefined, {
      status: "rejected",
      failure: { step: "input", violations: bannedWordViolations },
    });
  }

  const stepCtx = (step: StepName) => ({
    llmClient: deps.llmClient,
    clock,
    model: resolveModel(step, input.modelTierOverride),
    deadlineAt,
    signal: options.signal,
    onEvent: options.onEvent,
  });

  const effectiveNamingAgent = input.namingAgentOverride ?? namingAgent;
  const preset = presetNaming(input);
  const naming = preset
    ? { kind: "accepted" as const, accepted: preset, records: [] }
    : await runAgentStep(effectiveNamingAgent, { idea: input.idea, category: input.category, option: input.option }, stepCtx("naming"));
  records.push(...naming.records);
  qualityRetries += extraAttempts(naming.records);
  // Only recorded once the step actually made at least one call — a deadline pre-check can
  // stop it before that, and an unattempted step shouldn't claim a prompt version was used.
  if (naming.records.length > 0) promptVersions.naming = effectiveNamingAgent.promptVersion;
  if (naming.kind !== "accepted") {
    return finish(
      deps.store,
      clock,
      startedAt,
      runId,
      input.option,
      qualityRetries,
      records,
      promptVersions,
      undefined,
      toFinishResult("naming", naming),
    );
  }

  const brandName = naming.accepted.selectedName;

  const tagline = input.resume?.taglineDescription
    ? { kind: "accepted" as const, accepted: input.resume.taglineDescription, records: [] }
    : await runAgentStep(
        taglineDescriptionAgent,
        { idea: input.idea, category: input.category, option: input.option, brandName, existingToneNotes: input.followUpBrand?.toneNotes },
        stepCtx("tagline_description"),
      );
  records.push(...tagline.records);
  qualityRetries += extraAttempts(tagline.records);
  if (tagline.records.length > 0) promptVersions.tagline_description = taglineDescriptionAgent.promptVersion;
  if (tagline.kind !== "accepted") {
    return finish(
      deps.store,
      clock,
      startedAt,
      runId,
      input.option,
      qualityRetries,
      records,
      promptVersions,
      naming.accepted.candidates,
      toFinishResult("tagline_description", tagline),
    );
  }

  const packaging = await runAgentStep(
    packagingAgent,
    {
      idea: input.idea,
      category: input.category,
      option: input.option,
      brandName,
      tagline: tagline.accepted.tagline,
      description: tagline.accepted.description,
      toneNotes: tagline.accepted.tone_notes,
    },
    stepCtx("packaging"),
  );
  records.push(...packaging.records);
  qualityRetries += extraAttempts(packaging.records);
  if (packaging.records.length > 0) promptVersions.packaging = packagingAgent.promptVersion;
  if (packaging.kind !== "accepted") {
    return finish(
      deps.store,
      clock,
      startedAt,
      runId,
      input.option,
      qualityRetries,
      records,
      promptVersions,
      naming.accepted.candidates,
      toFinishResult("packaging", packaging),
    );
  }

  const outcome = buildSucceededOutcome({
    feasibilityOption: input.option,
    brandName,
    toneNotes: tagline.accepted.tone_notes,
    tagline: tagline.accepted.tagline,
    description: tagline.accepted.description,
    packaging: packaging.accepted,
    nameCandidates: naming.accepted.candidates,
    qualityRetries,
  });

  const latencyMs = clock.now() - startedAt;
  const ids = await deps.store.finishRun({
    runId,
    status: "succeeded",
    content: {
      brandName,
      toneNotes: tagline.accepted.tone_notes,
      tagline: tagline.accepted.tagline,
      description: tagline.accepted.description,
      packaging: packaging.accepted,
      feasibilitySnapshot: input.option,
      existingBrandId: input.followUpBrand?.id,
    },
    nameCandidates: naming.accepted.candidates,
    promptVersions,
    usage: sumUsage(records),
    qualityRetries,
    transportRetries: sumTransportRetries(records),
    latencyMs,
    steps: records,
  });

  return {
    runId,
    outcome,
    ids,
    meta: {
      models: modelsByStep(records),
      promptVersions,
      latencyMs,
      transportRetries: sumTransportRetries(records),
      usage: sumUsage(records),
    },
  };
}

// Three flows reach naming with the step already settled — a resume replaying an errored run's
// accepted output, a regenerate pinning one of an earlier run's other candidates (D30), and a
// brand follow-up reusing an existing brand's name (D29). They differ only in where the
// accepted value comes from; to everything downstream they mean the same thing, which is no
// LLM call and no `run_steps` row for this step.
function presetNaming(input: RunGenerationInput): NamingAccepted | undefined {
  if (input.resume?.naming) return input.resume.naming;
  if (input.regenerate) return input.regenerate.naming;
  // No candidates: a follow-up never had a naming step of its own to show alternatives from.
  if (input.followUpBrand) return { candidates: [], selectedName: input.followUpBrand.name };
  return undefined;
}

// --- generic per-step execution --------------------------------------------------------

type StepOutcome<Accepted> =
  | { kind: "accepted"; accepted: Accepted; records: RunStepRecord[] }
  | { kind: "rejected"; violations: Violation[]; records: RunStepRecord[] }
  | { kind: "input_blocked"; violations: Violation[]; records: RunStepRecord[] }
  | { kind: "transport_failed"; error: TransportFailureReason; message: string; records: RunStepRecord[] };

interface StepContext {
  llmClient: LlmClient;
  clock: Clock;
  model: string;
  deadlineAt: number;
  signal?: AbortSignal;
  onEvent?: (event: RunProgressEvent) => void;
}

// TRD.md §5: render prompt → generateJson → Zod parse → evaluate → accept, retry once with
// feedback, or reject. One retry, content failures only (D11) — a prompt block or a transport
// failure never consumes it, since neither is something a second attempt could fix.
async function runAgentStep<Input, Output, Accepted>(
  spec: AgentSpec<Input, Output, Accepted>,
  input: Input,
  ctx: StepContext,
): Promise<StepOutcome<Accepted>> {
  const jsonSchema = z.toJSONSchema(spec.outputSchema);
  const records: RunStepRecord[] = [];
  let previousViolations: Violation[] = [];

  for (let attempt: 1 | 2 = 1; ; ) {
    // Checked before every attempt, not just the step's first — a same-step quality retry is
    // just as much "starting something new" as moving to the next step is, and shouldn't get
    // an unchecked fresh ~10s call budget once the run deadline has already passed.
    if (ctx.clock.now() >= ctx.deadlineAt) {
      return {
        kind: "transport_failed",
        error: "timeout",
        message: `run deadline exceeded before ${spec.step} attempt ${attempt}`,
        records,
      };
    }
    if (attempt === 1) {
      ctx.onEvent?.({ type: "step_started", step: spec.step });
    }

    const variables = spec.toVariables(input);
    const system = renderTemplate(spec.prompt.system, { ...variables, retry_feedback: renderRetryFeedback(previousViolations) });
    const user = renderTemplate(spec.prompt.user, variables);

    const llmOutcome = await ctx.llmClient.generateJson({
      model: ctx.model,
      system,
      user,
      responseJsonSchema: jsonSchema,
      deadlineAt: ctx.deadlineAt,
      signal: ctx.signal,
    });

    const classified = classifyLlmOutcome(spec, input, llmOutcome);
    records.push(toRunStepRecord(spec.step, llmOutcome, attempt, ctx.model, spec.promptVersion, classified));
    ctx.onEvent?.({ type: "step_finished", step: spec.step, attempt, passed: classified.kind === "accepted" });

    if (classified.kind === "accepted") {
      return { kind: "accepted", accepted: classified.accepted, records };
    }
    if (classified.kind === "input_blocked") {
      return { kind: "input_blocked", violations: classified.violations, records };
    }
    if (classified.kind === "transport_failed") {
      return { kind: "transport_failed", error: classified.error, message: classified.message, records };
    }
    if (attempt === 2) {
      return { kind: "rejected", violations: classified.violations, records };
    }
    previousViolations = classified.violations;
    attempt = 2;
  }
}

type Classified<Accepted> =
  | { kind: "accepted"; accepted: Accepted; usage: TokenUsage; rawOutput: unknown }
  | { kind: "content_failed"; violations: Violation[]; usage: TokenUsage; rawOutput?: unknown }
  | { kind: "input_blocked"; violations: Violation[] }
  | { kind: "transport_failed"; error: TransportFailureReason; message: string };

function classifyLlmOutcome<Input, Output, Accepted>(
  spec: AgentSpec<Input, Output, Accepted>,
  input: Input,
  outcome: LlmOutcome,
): Classified<Accepted> {
  if (outcome.kind === "prompt_blocked") {
    return { kind: "input_blocked", violations: [{ rule: "input.safety", message: "Gemini blocked the prompt for safety" }] };
  }
  if (outcome.kind === "response_blocked") {
    return {
      kind: "content_failed",
      violations: [{ rule: "output.safety", message: "Gemini blocked the response for safety" }],
      usage: outcome.usage,
    };
  }
  if (outcome.kind === "failed") {
    // An unparsable response is a content problem, like a schema mismatch — it gets the same
    // quality retry a guardrail violation would, not a run-ending transport failure.
    if (outcome.error === "invalid_json") {
      return { kind: "content_failed", violations: [{ rule: "output.schema", message: outcome.message }], usage: zeroUsage() };
    }
    return { kind: "transport_failed", error: outcome.error, message: outcome.message };
  }

  // outcome.kind === "ok"
  const parsed = spec.outputSchema.safeParse(outcome.json);
  if (!parsed.success) {
    return {
      kind: "content_failed",
      violations: [{ rule: "output.schema", message: parsed.error.issues[0]?.message ?? "response did not match the expected shape" }],
      usage: outcome.usage,
      rawOutput: outcome.json,
    };
  }

  const evaluation = spec.evaluate(parsed.data, input);
  if (!evaluation.ok) {
    return { kind: "content_failed", violations: evaluation.violations, usage: outcome.usage, rawOutput: outcome.json };
  }
  return { kind: "accepted", accepted: evaluation.accepted, usage: outcome.usage, rawOutput: outcome.json };
}

function toRunStepRecord(
  step: StepName,
  outcome: LlmOutcome,
  attempt: 1 | 2,
  model: string,
  promptVersion: string,
  classified: Classified<unknown>,
): RunStepRecord {
  return {
    step,
    attempt,
    model,
    promptVersion,
    usage: "usage" in classified ? classified.usage : zeroUsage(),
    transportRetries: outcome.transportRetries,
    latencyMs: outcome.latencyMs,
    rawOutput: "rawOutput" in classified ? classified.rawOutput : undefined,
    violations: classified.kind === "accepted" || classified.kind === "transport_failed" ? [] : classified.violations,
    error: classified.kind === "transport_failed" ? classified.error : undefined,
  };
}

// --- persisting a run that didn't succeed -----------------------------------------------

type FinishResult = { status: "rejected"; failure: RejectedFailure } | { status: "error"; failure: ErrorFailure };

function toFinishResult<Accepted>(step: StepName, outcome: Exclude<StepOutcome<Accepted>, { kind: "accepted" }>): FinishResult {
  if (outcome.kind === "transport_failed") {
    return { status: "error", failure: { step, error: outcome.error, message: outcome.message } };
  }
  if (outcome.kind === "input_blocked") {
    return { status: "rejected", failure: { step: "input", violations: outcome.violations } };
  }
  return { status: "rejected", failure: { step, violations: outcome.violations } };
}

async function finish(
  store: GenerationStore,
  clock: Clock,
  startedAt: number,
  runId: string,
  option: FeasibilityOptionFacts,
  qualityRetries: number,
  records: RunStepRecord[],
  promptVersions: Partial<Record<StepName, string>>,
  nameCandidates: NameCandidateRecord[] | undefined,
  result: FinishResult,
): Promise<RunResult> {
  const latencyMs = clock.now() - startedAt;
  const usage = sumUsage(records);
  const transportRetries = sumTransportRetries(records);
  const meta: RunMeta = { models: modelsByStep(records), promptVersions, latencyMs, transportRetries, usage };

  if (result.status === "error") {
    await store.finishRun({
      runId,
      status: "error",
      failure: result.failure,
      nameCandidates,
      promptVersions,
      usage,
      qualityRetries,
      transportRetries,
      latencyMs,
      steps: records,
    });
    return {
      runId,
      meta,
      outcome: { status: "error", step: result.failure.step, error: result.failure.error, message: result.failure.message, qualityRetries },
    };
  }

  const outcome = buildRejectedOutcome({
    feasibilityOption: option,
    qualityRetries,
    step: result.failure.step,
    violations: result.failure.violations,
  });
  await store.finishRun({
    runId,
    status: "rejected",
    failure: result.failure,
    nameCandidates,
    promptVersions,
    usage,
    qualityRetries,
    transportRetries,
    latencyMs,
    steps: records,
  });
  return { runId, outcome, meta };
}

// A step's retry attempts (up to 2) always share one model — resolved once per step in
// stepCtx — so the first record for a step is enough to know which model the step used.
function modelsByStep(records: RunStepRecord[]): Partial<Record<StepName, string>> {
  const models: Partial<Record<StepName, string>> = {};
  for (const record of records) {
    models[record.step] ??= record.model;
  }
  return models;
}

// Quality retries beyond the first attempt for this step. A step can end with zero records at
// all (the run-deadline pre-check in runAgentStep returns before making any attempt) — plain
// `records.length - 1` would go negative there, so this floors at zero.
function extraAttempts(records: RunStepRecord[]): number {
  return Math.max(0, records.length - 1);
}

function zeroUsage(): TokenUsage {
  return { promptTokens: 0, candidatesTokens: 0, thoughtsTokens: 0, totalTokens: 0 };
}

function sumUsage(records: RunStepRecord[]): TokenUsage {
  return records.reduce(
    (total, record) => ({
      promptTokens: total.promptTokens + record.usage.promptTokens,
      candidatesTokens: total.candidatesTokens + record.usage.candidatesTokens,
      thoughtsTokens: total.thoughtsTokens + record.usage.thoughtsTokens,
      totalTokens: total.totalTokens + record.usage.totalTokens,
    }),
    zeroUsage(),
  );
}

function sumTransportRetries(records: RunStepRecord[]): number {
  return records.reduce((sum, record) => sum + record.transportRetries, 0);
}
