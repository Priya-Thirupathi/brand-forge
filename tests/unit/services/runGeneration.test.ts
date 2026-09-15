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

function createInMemoryStore(): { store: GenerationStore; finishedRuns: Map<string, FinishedRun> } {
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
    },
  };
  return { store, finishedRuns };
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
    expect(finishedRuns.get(result.runId)?.status).toBe("succeeded");
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
