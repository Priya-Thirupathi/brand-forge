import { describe, expect, it } from "vitest";
import { runGeneration, type RunGenerationInput, type RunProgressEvent } from "@/lib/services/runGeneration";
import type {
  Clock,
  FinishedRun,
  GenerationStore,
  LlmClient,
  LlmOutcome,
  NewRun,
  TokenUsage,
  TransportFailureReason,
} from "@/lib/services/ports";
import type { CategoryFacts, FeasibilityOptionFacts } from "@/lib/domain/types";
import { evaluateCandidates } from "@/lib/domain/guardrails/nameRules";

// Fixtures reused from tests/unit/domain/agents.test.ts, already proven to pass each agent's
// evaluate() — reusing them keeps this file about orchestration, not about crafting copy that
// happens to clear every guardrail.
const category: CategoryFacts = {
  slug: "pet_treats",
  displayName: "Pet Treats",
  keywords: ["pet treat", "pet treats", "treat", "treats", "dog treat", "dog treats"],
};

const option: FeasibilityOptionFacts = {
  material: "Recyclable Stand-Up Pouch",
  materialTerms: ["paper pouch", "recyclable pouch", "kraft"],
  costLow: 0.4,
  costHigh: 0.6,
  currency: "USD",
  moq: 3000,
  leadTimeDaysLow: 25,
  leadTimeDaysHigh: 35,
  assumptions: "illustrative",
};

const validNamingJson = {
  candidates: [
    { name: "Wagwell", rationale: "friendly and warm" },
    { name: "Barkline", rationale: "playful" },
    { name: "Pet Treats", rationale: "descriptive but fails category rule" },
  ],
};

const validTaglineJson = {
  tagline: "Small treats, big trust",
  description:
    "Wagwell makes grain-free training treats sized for small dogs and big training sessions. " +
    "Every treat is baked in small batches with real, recognizable ingredients — no fillers, no " +
    "mystery meat, just something worth working for. Packed in a recyclable pouch, shipped fast, " +
    "and made for dogs who deserve better snacks during every walk and every trick they learn.",
  tone_notes: {
    voice: ["warm", "playful", "trustworthy"],
    audience: "small-dog owners who train with treats",
    personality: "an encouraging trainer, not a lecture",
    avoid: ["corporate jargon"],
  },
};

const validPackagingJson = {
  headline: "Wagwell training treats",
  body:
    "Baked in small batches with real, recognizable ingredients, Wagwell treats are sized for " +
    "training small dogs — no fillers, no mystery meat, just something worth working for on every walk.",
  callouts: ["Small-batch baked", "Real ingredients only"],
};

function zeroUsage(): TokenUsage {
  return { promptTokens: 0, candidatesTokens: 0, thoughtsTokens: 0, totalTokens: 0 };
}

function okOutcome(json: unknown, overrides: Partial<Extract<LlmOutcome, { kind: "ok" }>> = {}): LlmOutcome {
  return { kind: "ok", json, usage: zeroUsage(), transportRetries: 0, latencyMs: 10, ...overrides };
}

function promptBlockedOutcome(): LlmOutcome {
  return { kind: "prompt_blocked", transportRetries: 0, latencyMs: 5 };
}

function failedOutcome(error: TransportFailureReason, message = "boom"): LlmOutcome {
  return { kind: "failed", error, message, transportRetries: 0, latencyMs: 5 };
}

function createScriptedLlmClient(responses: LlmOutcome[]): { client: LlmClient; systemPrompts: string[] } {
  let index = 0;
  const systemPrompts: string[] = [];
  const client: LlmClient = {
    async generateJson(request) {
      systemPrompts.push(request.system);
      const response = responses[index++];
      if (response === undefined) throw new Error(`no scripted response for call ${index}`);
      return response;
    },
  };
  return { client, systemPrompts };
}

function createInMemoryStore(): { store: GenerationStore; startedRuns: Map<string, NewRun>; finishedRuns: Map<string, FinishedRun> } {
  let counter = 0;
  const startedRuns = new Map<string, NewRun>();
  const finishedRuns = new Map<string, FinishedRun>();
  const store: GenerationStore = {
    async findOption() {
      return null;
    },
    async countRuns() {
      return 0;
    },
    async startRun(run) {
      const id = `run-${++counter}`;
      startedRuns.set(id, run);
      return id;
    },
    async finishRun(record) {
      finishedRuns.set(record.runId, record);
      return record.status === "succeeded" ? { brandId: "brand-1", productId: "product-1" } : undefined;
    },
  };
  return { store, startedRuns, finishedRuns };
}

function createSteppedClock(values: number[]): Clock {
  let index = 0;
  return { now: () => values[Math.min(index++, values.length - 1)] };
}

function baseInput(overrides: Partial<RunGenerationInput> = {}): RunGenerationInput {
  return {
    idea: "grain-free training treats for small dogs",
    category,
    feasibilityOptionId: "option-1",
    option,
    source: "user",
    clientIpHash: "hash",
    ...overrides,
  };
}

describe("runGeneration", () => {
  it("runs all three steps, emits events in order, and persists a succeeded run", async () => {
    const { client } = createScriptedLlmClient([okOutcome(validNamingJson), okOutcome(validTaglineJson), okOutcome(validPackagingJson)]);
    const { store, finishedRuns } = createInMemoryStore();
    const events: RunProgressEvent[] = [];

    const result = await runGeneration(baseInput(), { llmClient: client, store }, { onEvent: (event) => events.push(event) });

    expect(result.outcome.status).toBe("succeeded");
    if (result.outcome.status === "succeeded") {
      expect(result.outcome.brandName).toBe("Wagwell");
      expect(result.outcome.qualityRetries).toBe(0);
    }
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "step_started",
      "step_finished",
      "step_started",
      "step_finished",
      "step_started",
      "step_finished",
    ]);
    const finished = finishedRuns.get(result.runId);
    expect(finished?.status).toBe("succeeded");
    if (finished?.status === "succeeded") {
      expect(finished.content).toMatchObject({ brandName: "Wagwell", tagline: validTaglineJson.tagline });
      expect(finished.content.feasibilitySnapshot).toEqual(option);
    }
    expect(finished?.nameCandidates?.map((c) => c.name)).toEqual(["Wagwell", "Barkline", "Pet Treats"]);
    expect(result.ids).toEqual({ brandId: "brand-1", productId: "product-1" });
    expect(result.meta.models).toEqual({
      naming: expect.any(String),
      tagline_description: expect.any(String),
      packaging: expect.any(String),
    });
    expect(Object.keys(result.meta.promptVersions)).toEqual(["naming", "tagline_description", "packaging"]);
    expect(result.meta.transportRetries).toBe(0);
  });

  it("carries the naming candidates into a persisted rejection from a later step", async () => {
    const tooFewCallouts = { ...validPackagingJson, callouts: [] }; // packaging.callouts violation, both attempts
    const { client } = createScriptedLlmClient([
      okOutcome(validNamingJson),
      okOutcome(validTaglineJson),
      okOutcome(tooFewCallouts),
      okOutcome(tooFewCallouts),
    ]);
    const { store, finishedRuns } = createInMemoryStore();

    const result = await runGeneration(baseInput(), { llmClient: client, store });

    expect(result.outcome.status).toBe("rejected");
    const finished = finishedRuns.get(result.runId);
    expect(finished?.status).toBe("rejected");
    if (finished?.status === "rejected") {
      expect(finished.failure.step).toBe("packaging");
    }
    // Naming actually succeeded before packaging failed — its candidates are still worth
    // persisting for /api/runs debugging, not just discarded because the run didn't succeed.
    expect(finished?.nameCandidates?.map((c) => c.name)).toEqual(["Wagwell", "Barkline", "Pet Treats"]);
  });

  it("retries a content failure once, including the failed rules in the retry prompt, and can still succeed", async () => {
    const tooFewCandidates = { candidates: [{ name: "Wagwell", rationale: "r" }] }; // name.count violation
    const { client, systemPrompts } = createScriptedLlmClient([
      okOutcome(tooFewCandidates),
      okOutcome(validNamingJson),
      okOutcome(validTaglineJson),
      okOutcome(validPackagingJson),
    ]);
    const { store } = createInMemoryStore();

    const result = await runGeneration(baseInput(), { llmClient: client, store });

    expect(result.outcome.status).toBe("succeeded");
    expect(systemPrompts).toHaveLength(4);
    expect(systemPrompts[1]).toContain("name.count");
  });

  it("rejects with no content after a second content failure, without calling later steps", async () => {
    const tooFewCandidates = { candidates: [{ name: "Wagwell", rationale: "r" }] };
    const { client, systemPrompts } = createScriptedLlmClient([okOutcome(tooFewCandidates), okOutcome(tooFewCandidates)]);
    const { store } = createInMemoryStore();
    const events: RunProgressEvent[] = [];

    const result = await runGeneration(baseInput(), { llmClient: client, store }, { onEvent: (event) => events.push(event) });

    expect(result.outcome.status).toBe("rejected");
    if (result.outcome.status === "rejected") {
      expect(result.outcome.failure.step).toBe("naming");
      expect(result.outcome.qualityRetries).toBe(1);
      expect("brandName" in result.outcome).toBe(false);
    }
    expect(systemPrompts).toHaveLength(2);
    expect(events.filter((event) => event.type === "step_finished")).toHaveLength(2);
  });

  it("doesn't consume a quality attempt for transport retries the adapter already absorbed", async () => {
    const { client, systemPrompts } = createScriptedLlmClient([
      okOutcome(validNamingJson, { transportRetries: 3 }),
      okOutcome(validTaglineJson),
      okOutcome(validPackagingJson),
    ]);
    const { store, finishedRuns } = createInMemoryStore();

    const result = await runGeneration(baseInput(), { llmClient: client, store });

    expect(result.outcome.status).toBe("succeeded");
    if (result.outcome.status === "succeeded") expect(result.outcome.qualityRetries).toBe(0);
    expect(systemPrompts).toHaveLength(3); // one call for naming, despite the embedded transport retries
    expect(finishedRuns.get(result.runId)?.transportRetries).toBe(3);
  });

  it("ends the run as error on a transport failure, without attempting a quality retry", async () => {
    const { client, systemPrompts } = createScriptedLlmClient([failedOutcome("provider_error", "503 from gemini")]);
    const { store, finishedRuns } = createInMemoryStore();

    const result = await runGeneration(baseInput(), { llmClient: client, store });

    expect(result.outcome.status).toBe("error");
    if (result.outcome.status === "error") {
      expect(result.outcome.step).toBe("naming");
      expect(result.outcome.error).toBe("provider_error");
    }
    expect(systemPrompts).toHaveLength(1);
    expect(finishedRuns.get(result.runId)?.status).toBe("error");
  });

  it("rejects at input, not the step, on a prompt safety block — with no retry", async () => {
    const { client, systemPrompts } = createScriptedLlmClient([promptBlockedOutcome()]);
    const { store } = createInMemoryStore();

    const result = await runGeneration(baseInput(), { llmClient: client, store });

    expect(result.outcome.status).toBe("rejected");
    if (result.outcome.status === "rejected") {
      expect(result.outcome.failure.step).toBe("input");
      expect(result.outcome.failure.violations).toEqual([
        { rule: "input.safety", message: expect.any(String) },
      ]);
    }
    expect(systemPrompts).toHaveLength(1);
  });

  it("rejects at input on a banned word in the idea, before any generation call", async () => {
    const { client, systemPrompts } = createScriptedLlmClient([]);
    const { store } = createInMemoryStore();

    const result = await runGeneration(baseInput({ idea: "a scam-proof treat dispenser" }), { llmClient: client, store });

    expect(result.outcome.status).toBe("rejected");
    if (result.outcome.status === "rejected") {
      expect(result.outcome.failure.step).toBe("input");
      expect(result.outcome.failure.violations[0].rule).toBe("input.banned_word");
    }
    expect(systemPrompts).toHaveLength(0);
  });

  it("ends the run as a timeout error once the run deadline passes before a later step starts", async () => {
    const { client, systemPrompts } = createScriptedLlmClient([okOutcome(validNamingJson)]);
    const { store, finishedRuns } = createInMemoryStore();
    // Calls, in order: startedAt, naming's pre-attempt deadline check (still within budget),
    // tagline_description's pre-attempt deadline check (past the 25s deadline), finish()'s
    // latency calculation.
    const clock = createSteppedClock([0, 100, 30_000, 30_000]);

    const result = await runGeneration(baseInput(), { llmClient: client, store, clock });

    expect(result.outcome.status).toBe("error");
    if (result.outcome.status === "error") {
      expect(result.outcome.step).toBe("tagline_description");
      expect(result.outcome.error).toBe("timeout");
      // naming succeeded on its first attempt (0 extra attempts); the deadline pre-check that
      // stopped tagline_description made zero attempts, not a negative number of them.
      expect(result.outcome.qualityRetries).toBe(0);
    }
    expect(systemPrompts).toHaveLength(1); // packaging never called either

    // naming actually ran (one real call), so its prompt version is legitimately known; the
    // deadline stopped tagline_description before it made any call, so it shouldn't claim one.
    const promptVersions = finishedRuns.get(result.runId)?.promptVersions;
    expect(promptVersions).toHaveProperty("naming");
    expect(promptVersions).not.toHaveProperty("tagline_description");
  });

  it("checks the run deadline again before a same-step quality retry, not just before the step starts", async () => {
    const tooFewCandidates = { candidates: [{ name: "Wagwell", rationale: "r" }] }; // name.count violation
    const { client, systemPrompts } = createScriptedLlmClient([okOutcome(tooFewCandidates)]);
    const { store } = createInMemoryStore();
    // Calls, in order: startedAt, naming attempt 1's pre-attempt deadline check (within
    // budget), naming attempt 2's pre-attempt deadline check (past the deadline — attempt 2
    // must never be requested), finish()'s latency calculation.
    const clock = createSteppedClock([0, 100, 30_000, 30_000]);

    const result = await runGeneration(baseInput(), { llmClient: client, store, clock });

    expect(result.outcome.status).toBe("error");
    if (result.outcome.status === "error") {
      expect(result.outcome.step).toBe("naming");
      expect(result.outcome.error).toBe("timeout");
      // Attempt 1 happened and failed on content; attempt 2 never started, so it's zero
      // completed retries, not one.
      expect(result.outcome.qualityRetries).toBe(0);
    }
    expect(systemPrompts).toHaveLength(1); // the would-be quality retry was never requested
  });

  it("resume: skips naming entirely when a prior accepted naming output is supplied", async () => {
    const { client, systemPrompts } = createScriptedLlmClient([okOutcome(validTaglineJson), okOutcome(validPackagingJson)]);
    const { store, finishedRuns } = createInMemoryStore();
    const resumedNaming = { selectedName: "Wagwell", candidates: [{ name: "Wagwell", rationale: "r", passed: true, violations: [] }] };

    const result = await runGeneration(
      baseInput({ resumedFromRunId: "run-failed-1", resume: { naming: resumedNaming } }),
      { llmClient: client, store },
    );

    expect(result.outcome.status).toBe("succeeded");
    if (result.outcome.status === "succeeded") {
      expect(result.outcome.brandName).toBe("Wagwell");
    }
    expect(systemPrompts).toHaveLength(2); // tagline_description + packaging only, no naming call
    // No naming record was made this run, so it shouldn't claim a prompt version for this run.
    expect(Object.keys(result.meta.promptVersions)).toEqual(["tagline_description", "packaging"]);
    expect(finishedRuns.get(result.runId)?.nameCandidates?.map((c) => c.name)).toEqual(["Wagwell"]);
  });

  it("resume: skips both naming and tagline_description when both are supplied, retrying only packaging", async () => {
    const { client, systemPrompts } = createScriptedLlmClient([okOutcome(validPackagingJson)]);
    const { store } = createInMemoryStore();
    const resumedNaming = { selectedName: "Wagwell", candidates: [{ name: "Wagwell", rationale: "r", passed: true, violations: [] }] };

    const result = await runGeneration(
      baseInput({
        resumedFromRunId: "run-failed-2",
        resume: { naming: resumedNaming, taglineDescription: validTaglineJson },
      }),
      { llmClient: client, store },
    );

    expect(result.outcome.status).toBe("succeeded");
    expect(systemPrompts).toHaveLength(1); // packaging only
  });

  it("resume: a fresh transport failure on the retried step still ends the run as error", async () => {
    const { client } = createScriptedLlmClient([failedOutcome("provider_error", "still 503")]);
    const { store, finishedRuns } = createInMemoryStore();
    const resumedNaming = { selectedName: "Wagwell", candidates: [{ name: "Wagwell", rationale: "r", passed: true, violations: [] }] };

    const result = await runGeneration(
      baseInput({ resumedFromRunId: "run-failed-3", resume: { naming: resumedNaming } }),
      { llmClient: client, store },
    );

    expect(result.outcome.status).toBe("error");
    if (result.outcome.status === "error") {
      expect(result.outcome.step).toBe("tagline_description");
    }
    // The resumed run's own naming candidates still carry through, even though naming wasn't
    // re-run this time — a resumed-and-failed-again run is just as debuggable as a fresh one.
    expect(finishedRuns.get(result.runId)?.nameCandidates?.map((c) => c.name)).toEqual(["Wagwell"]);
  });

  it("follow-up (D29): skips naming and constrains tagline_description to the existing brand's tone", async () => {
    const existingToneNotes = { voice: ["rugged", "direct"], audience: "trail runners", personality: "a no-nonsense guide", avoid: [] };
    const ridgeTaglineJson = { ...validTaglineJson, description: validTaglineJson.description.replace(/Wagwell/g, "Ridge") };
    const ridgePackagingJson = {
      ...validPackagingJson,
      headline: validPackagingJson.headline.replace("Wagwell", "Ridge"),
      body: validPackagingJson.body.replace(/Wagwell/g, "Ridge"),
    };
    const { client, systemPrompts } = createScriptedLlmClient([okOutcome(ridgeTaglineJson), okOutcome(ridgePackagingJson)]);
    const { store, finishedRuns } = createInMemoryStore();

    const result = await runGeneration(
      baseInput({ followUpBrand: { id: "brand-42", name: "Ridge", toneNotes: existingToneNotes } }),
      { llmClient: client, store },
    );

    expect(result.outcome.status).toBe("succeeded");
    if (result.outcome.status === "succeeded") {
      expect(result.outcome.brandName).toBe("Ridge");
      expect(result.outcome.toneNotes).toEqual(existingToneNotes);
      expect(result.outcome.nameCandidates).toEqual([]);
    }
    expect(systemPrompts).toHaveLength(2); // tagline_description + packaging only, no naming call
    expect(Object.keys(result.meta.promptVersions)).toEqual(["tagline_description", "packaging"]);
    // The tagline_description prompt is told to match the existing tone, not invent one.
    expect(systemPrompts[0]).toContain("Ridge");
    const finished = finishedRuns.get(result.runId);
    expect(finished?.status).toBe("succeeded");
    if (finished?.status === "succeeded") {
      expect(finished.content.existingBrandId).toBe("brand-42");
      expect(finished.content.toneNotes).toEqual(existingToneNotes);
    }
  });

  it("follow-up (D29): a content failure on the retried tagline_description step still rejects, not naming", async () => {
    const tooShortTagline = { ...validTaglineJson, tagline: "x" }; // tagline.length violation, both attempts
    const { client } = createScriptedLlmClient([okOutcome(tooShortTagline), okOutcome(tooShortTagline)]);
    const { store } = createInMemoryStore();

    const result = await runGeneration(
      baseInput({ followUpBrand: { id: "brand-42", name: "Ridge", toneNotes: validTaglineJson.tone_notes } }),
      { llmClient: client, store },
    );

    expect(result.outcome.status).toBe("rejected");
    if (result.outcome.status === "rejected") {
      expect(result.outcome.failure.step).toBe("tagline_description");
    }
  });

  it("regenerate (D30): skips naming, pins the alternate candidate, and carries the whole set through", async () => {
    const barklineTaglineJson = { ...validTaglineJson, description: validTaglineJson.description.replace(/Wagwell/g, "Barkline") };
    const barklinePackagingJson = {
      ...validPackagingJson,
      headline: validPackagingJson.headline.replace("Wagwell", "Barkline"),
      body: validPackagingJson.body.replace(/Wagwell/g, "Barkline"),
    };
    const { client, systemPrompts } = createScriptedLlmClient([okOutcome(barklineTaglineJson), okOutcome(barklinePackagingJson)]);
    const { store, startedRuns, finishedRuns } = createInMemoryStore();
    const candidates = evaluateCandidates(validNamingJson.candidates, category);

    const result = await runGeneration(
      baseInput({ regenerate: { fromRunId: "run-origin", naming: { candidates, selectedName: "Barkline" } } }),
      { llmClient: client, store },
    );

    expect(result.outcome.status).toBe("succeeded");
    if (result.outcome.status === "succeeded") {
      expect(result.outcome.brandName).toBe("Barkline");
      // The same passing names still show, with the alternate now marked selected. "Pet Treats"
      // stays filtered out — it never passed the category rule, so it was never on offer.
      expect(result.outcome.nameCandidates).toEqual([
        { name: "Wagwell", selected: false },
        { name: "Barkline", selected: true },
      ]);
      // A regenerate writes a fresh tone around the new name — deliberately the opposite of a
      // D29 follow-up, which carries the existing brand's tone over unchanged.
      expect(result.outcome.toneNotes).toEqual(barklineTaglineJson.tone_notes);
    }
    expect(systemPrompts).toHaveLength(2); // tagline_description + packaging only, no naming call
    expect(Object.keys(result.meta.promptVersions)).toEqual(["tagline_description", "packaging"]);
    expect(startedRuns.get(result.runId)?.regeneratedFromRunId).toBe("run-origin");
    expect(startedRuns.get(result.runId)?.resumedFromRunId).toBeUndefined();

    const finished = finishedRuns.get(result.runId);
    // The origin's full set — failed candidates included — is stored on this run too, which is
    // what lets a *second* regenerate read its candidates back off this run rather than 404ing.
    expect(finished?.nameCandidates?.map((c) => c.name)).toEqual(["Wagwell", "Barkline", "Pet Treats"]);
    if (finished?.status === "succeeded") {
      // A different name means a different brand: nothing is attached to the origin's brand row.
      expect(finished.content.existingBrandId).toBeUndefined();
    }
  });

  it("regenerate (D30): a resume in the same request still wins, so the client must not send both", async () => {
    // Not a supported combination — useGeneration clears resume_from_run_id when regenerating.
    // Pinned as a test because the precedence is silent: the user would get the original name
    // back with no error, which is why the hook clears it rather than relying on the server.
    const { client } = createScriptedLlmClient([okOutcome(validTaglineJson), okOutcome(validPackagingJson)]);
    const { store } = createInMemoryStore();
    const candidates = evaluateCandidates(validNamingJson.candidates, category);

    const result = await runGeneration(
      baseInput({
        resume: { naming: { candidates, selectedName: "Wagwell" } },
        regenerate: { fromRunId: "run-origin", naming: { candidates, selectedName: "Barkline" } },
      }),
      { llmClient: client, store },
    );

    expect(result.outcome.status === "succeeded" && result.outcome.brandName).toBe("Wagwell");
  });

  it("passes the caller's abort signal through to the LLM client on every call", async () => {
    const controller = new AbortController();
    let sawSignal: AbortSignal | undefined;
    const client: LlmClient = {
      async generateJson(request) {
        sawSignal = request.signal;
        return okOutcome(validNamingJson);
      },
    };
    const { store } = createInMemoryStore();

    await runGeneration(baseInput(), { llmClient: client, store }, { signal: controller.signal });

    expect(sawSignal).toBe(controller.signal);
  });
});
