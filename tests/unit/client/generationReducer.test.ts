import { describe, expect, it } from "vitest";
import { generationReducer, initialGenerationState, type GenerationState } from "@/lib/client/generationReducer";
import type { GenerateResult } from "@/lib/contracts/generate";

function succeededResult(overrides: Partial<GenerateResult> = {}): GenerateResult {
  return {
    run_id: "run-1",
    status: "succeeded",
    feasibility: {
      material: "Stainless Steel",
      cost_low: 3.2,
      cost_high: 4.8,
      currency: "USD",
      moq: 500,
      lead_time_days_low: 35,
      lead_time_days_high: 50,
      assumptions: "test",
      first_run_cost_low: 1600,
      first_run_cost_high: 2400,
    },
    brand: { id: "brand-1", name: "Ridge", tone_notes: { voice: ["bold"], audience: "hikers", personality: "rugged", avoid: [] } },
    product: { id: "product-1", tagline: "Built for the trail", description: "d".repeat(50), packaging: { headline: "h", body: "b", callouts: [] } },
    name_candidates: [{ name: "Ridge", selected: true }],
    guardrails: { quality_retries: 0 },
    meta: { models: { naming: "gemini-3.8-flash" }, prompt_versions: { naming: "abc123" }, latency_ms: 1200, transport_retries: 0, tokens: { input: 10, output: 20, thinking: 5 } },
    ...overrides,
  };
}

describe("generationReducer", () => {
  it("starts idle", () => {
    expect(initialGenerationState).toEqual({ status: "idle" });
  });

  it("moves to running with all steps pending on submit", () => {
    const state = generationReducer(initialGenerationState, { type: "submit" });
    expect(state).toEqual({
      status: "running",
      steps: { naming: "pending", tagline_description: "pending", packaging: "pending" },
    });
  });

  it("tracks run_started, step_started, and step_finished events in order", () => {
    let state: GenerationState = generationReducer(initialGenerationState, { type: "submit" });
    state = generationReducer(state, { type: "stream_event", event: { type: "run_started", run_id: "run-1" } });
    state = generationReducer(state, { type: "stream_event", event: { type: "step_started", step: "naming" } });

    expect(state).toMatchObject({ status: "running", runId: "run-1", steps: { naming: "in_progress" } });

    state = generationReducer(state, { type: "stream_event", event: { type: "step_finished", step: "naming", attempt: 1, passed: true } });
    expect((state as { steps: Record<string, string> }).steps.naming).toBe("passed");
  });

  it("marks a step retrying on a failed first attempt, and failed on a failed second attempt", () => {
    let state: GenerationState = generationReducer(initialGenerationState, { type: "submit" });
    state = generationReducer(state, { type: "stream_event", event: { type: "step_finished", step: "naming", attempt: 1, passed: false } });
    expect((state as { steps: Record<string, string> }).steps.naming).toBe("retrying");

    state = generationReducer(state, { type: "stream_event", event: { type: "step_finished", step: "naming", attempt: 2, passed: false } });
    expect((state as { steps: Record<string, string> }).steps.naming).toBe("failed");
  });

  it("moves to succeeded/rejected on a result event, carrying the full GenerateResult", () => {
    const result = succeededResult();
    let state: GenerationState = generationReducer(initialGenerationState, { type: "submit" });
    state = generationReducer(state, { type: "stream_event", event: { type: "result", result } });
    expect(state).toEqual({ status: "succeeded", result });
  });

  it("moves to run_error on a mid-run error event, carrying the failed step", () => {
    let state: GenerationState = generationReducer(initialGenerationState, { type: "submit" });
    state = generationReducer(state, {
      type: "stream_event",
      event: { type: "error", run_id: "run-1", code: "quota_exhausted", message: "Daily quota exhausted", step: "naming" },
    });
    expect(state).toEqual({ status: "run_error", runId: "run-1", code: "quota_exhausted", message: "Daily quota exhausted", step: "naming" });
  });

  it("carries a later failed step through run_error, the client's resumable signal", () => {
    let state: GenerationState = generationReducer(initialGenerationState, { type: "submit" });
    state = generationReducer(state, {
      type: "stream_event",
      event: { type: "error", run_id: "run-1", code: "provider_error", message: "503 from gemini", step: "packaging" },
    });
    expect(state).toMatchObject({ status: "run_error", step: "packaging" });
  });

  it("ignores a stream event once a terminal state is reached", () => {
    const result = succeededResult();
    let state: GenerationState = generationReducer(initialGenerationState, { type: "submit" });
    state = generationReducer(state, { type: "stream_event", event: { type: "result", result } });
    const afterResult = state;

    state = generationReducer(state, { type: "stream_event", event: { type: "step_started", step: "naming" } });
    expect(state).toBe(afterResult);
  });

  it("moves to admission_error on a pre-stream 429/400/500, independent of any run", () => {
    const state = generationReducer(initialGenerationState, {
      type: "admission_error",
      httpStatus: 429,
      error: "rate_limited",
      message: "Too many generations",
      retryAfterS: 3600,
    });
    expect(state).toEqual({ status: "admission_error", httpStatus: 429, error: "rate_limited", message: "Too many generations", retryAfterS: 3600 });
  });

  it("moves a running generation to run_error if the stream itself fails", () => {
    let state: GenerationState = generationReducer(initialGenerationState, { type: "submit" });
    state = generationReducer(state, { type: "stream_event", event: { type: "run_started", run_id: "run-1" } });
    state = generationReducer(state, { type: "stream_failed", message: "network drop" });
    expect(state).toEqual({ status: "run_error", runId: "run-1", code: "internal", message: "network drop", step: "naming" });
  });

  it("reset always returns to idle", () => {
    const result = succeededResult();
    let state: GenerationState = generationReducer(initialGenerationState, { type: "submit" });
    state = generationReducer(state, { type: "stream_event", event: { type: "result", result } });
    state = generationReducer(state, { type: "reset" });
    expect(state).toEqual({ status: "idle" });
  });

  it("carries isReplay from submit through to the running and succeeded states", () => {
    const result = succeededResult();
    let state: GenerationState = generationReducer(initialGenerationState, { type: "submit", isReplay: true });
    expect(state).toMatchObject({ status: "running", isReplay: true });

    state = generationReducer(state, { type: "stream_event", event: { type: "result", result } });
    expect(state).toMatchObject({ status: "succeeded", isReplay: true });
  });

  it("leaves isReplay unset for an ordinary submit", () => {
    const state = generationReducer(initialGenerationState, { type: "submit" });
    expect((state as { isReplay?: boolean }).isReplay).toBeUndefined();
  });
});
