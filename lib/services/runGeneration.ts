import { z } from "zod";
import type { StepName } from "@/lib/contracts/stepName";
import type { Violation } from "@/lib/contracts/violation";
import type { CategoryFacts, FeasibilityOptionFacts } from "@/lib/domain/types";
import type { AgentSpec } from "@/lib/domain/agents/types";
import { namingAgent } from "@/lib/domain/agents/naming";
import { taglineDescriptionAgent } from "@/lib/domain/agents/taglineDescription";
import { packagingAgent } from "@/lib/domain/agents/packaging";
import { renderTemplate } from "@/lib/domain/prompts/render";
import { renderRetryFeedback } from "@/lib/domain/prompts/retryFeedback";
import { checkBannedWordInIdea } from "@/lib/domain/guardrails/inputRules";
import { buildRejectedOutcome, buildSucceededOutcome, type GenerationOutcome } from "@/lib/domain/result";
import { resolveModel } from "@/config/routing";
import type {
  Clock,
  GenerationStore,
  LlmClient,
  LlmOutcome,
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

export interface RunResult {
  runId: string;
  outcome: GenerationOutcome | RunErrorOutcome;
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
  });
  options.onEvent?.({ type: "run_started", runId });

  const records: RunStepRecord[] = [];
  const promptVersions: Partial<Record<StepName, string>> = {};
  let qualityRetries = 0;

  // input.banned_word (TRD.md §7) — checked once, before any generation call is spent on it.
  const bannedWordViolations = checkBannedWordInIdea(input.idea);
  if (bannedWordViolations.length > 0) {
    return finish(deps.store, clock, startedAt, runId, input.option, qualityRetries, records, promptVersions, {
      status: "rejected",
      step: "input",
      violations: bannedWordViolations,
    });
  }

  const stepCtx = (step: StepName) => ({
    llmClient: deps.llmClient,
    clock,
    model: resolveModel(step),
    deadlineAt,
    signal: options.signal,
    onEvent: options.onEvent,
  });

  promptVersions.naming = namingAgent.promptVersion;
  const naming = await runAgentStep(
    namingAgent,
    { idea: input.idea, category: input.category, option: input.option },
    stepCtx("naming"),
  );
  records.push(...naming.records);
  qualityRetries += extraAttempts(naming.records);
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
      toFinishResult("naming", naming),
    );
  }

  const brandName = naming.accepted.selectedName;

  promptVersions.tagline_description = taglineDescriptionAgent.promptVersion;
  const tagline = await runAgentStep(
    taglineDescriptionAgent,
    { idea: input.idea, category: input.category, option: input.option, brandName },
    stepCtx("tagline_description"),
  );
  records.push(...tagline.records);
  qualityRetries += extraAttempts(tagline.records);
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
      toFinishResult("tagline_description", tagline),
    );
  }

  promptVersions.packaging = packagingAgent.promptVersion;
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

  await deps.store.finishRun({
    runId,
    status: "succeeded",
    nameCandidates: naming.accepted.candidates,
    promptVersions,
    usage: sumUsage(records),
    qualityRetries,
    transportRetries: sumTransportRetries(records),
    latencyMs: clock.now() - startedAt,
    steps: records,
  });

  return { runId, outcome };
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
  if (ctx.clock.now() >= ctx.deadlineAt) {
    return {
      kind: "transport_failed",
      error: "timeout",
      message: `run deadline exceeded before the ${spec.step} step started`,
      records: [],
    };
  }

  ctx.onEvent?.({ type: "step_started", step: spec.step });
  const jsonSchema = z.toJSONSchema(spec.outputSchema);
  const records: RunStepRecord[] = [];
  let previousViolations: Violation[] = [];

  for (let attempt: 1 | 2 = 1; ; ) {
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

type FinishResult =
  | { status: "rejected"; step: StepName | "input"; violations: Violation[] }
  | { status: "error"; step: StepName; error: TransportFailureReason; message: string };

function toFinishResult<Accepted>(step: StepName, outcome: Exclude<StepOutcome<Accepted>, { kind: "accepted" }>): FinishResult {
  if (outcome.kind === "transport_failed") {
    return { status: "error", step, error: outcome.error, message: outcome.message };
  }
  if (outcome.kind === "input_blocked") {
    return { status: "rejected", step: "input", violations: outcome.violations };
  }
  return { status: "rejected", step, violations: outcome.violations };
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
  result: FinishResult,
): Promise<RunResult> {
  const latencyMs = clock.now() - startedAt;
  const usage = sumUsage(records);
  const transportRetries = sumTransportRetries(records);

  if (result.status === "error") {
    await store.finishRun({
      runId,
      status: "error",
      failure: { step: result.step, error: result.error, message: result.message },
      promptVersions,
      usage,
      qualityRetries,
      transportRetries,
      latencyMs,
      steps: records,
    });
    return { runId, outcome: { status: "error", step: result.step, error: result.error, message: result.message, qualityRetries } };
  }

  const outcome = buildRejectedOutcome({ feasibilityOption: option, qualityRetries, step: result.step, violations: result.violations });
  await store.finishRun({
    runId,
    status: "rejected",
    failure: { step: result.step, violations: result.violations },
    promptVersions,
    usage,
    qualityRetries,
    transportRetries,
    latencyMs,
    steps: records,
  });
  return { runId, outcome };
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
