import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runEvalFixture } from "@/lib/eval/runner";
import { createEvalRun, getEvalRun, insertEvalResult, listEvalResults } from "@/lib/adapters/postgres/evalStore";
import type { EvalCase, EvalResultRow } from "@/lib/contracts/eval";
import type { GenerateEvent, GenerateResult } from "@/lib/contracts/generate";
import type { LlmClient, LlmOutcome } from "@/lib/services/ports";
import { resetDb, testPool } from "../setup/testDb";

// Exercises the actual DB persistence (real Postgres, like generationStore/evalStore's own
// integration tests) with fake network (fetch) and judge (LlmClient) — the same split
// runGeneration.test.ts uses for the LLM, applied here to the harness's own orchestration.

beforeEach(resetDb);
afterAll(async () => {
  await testPool.end();
});

const CASES: EvalCase[] = [
  { id: "c-pass", category: "candle", idea: "a lavender candle for people who have trouble sleeping", expected_outcome: "pass" },
  { id: "c-reject", category: "candle", idea: "a candle idea that gets rejected by a guardrail", expected_outcome: "reject" },
  { id: "c-admission", category: "candle", idea: "an idea that never even gets admitted", expected_outcome: "safe" },
];

async function seedRun(status: "succeeded" | "rejected"): Promise<string> {
  const { rows } = await testPool.query<{ id: string }>(
    `insert into runs (source, idea, status, prompt_versions, client_ip_hash) values ('eval', 'test idea', $1, '{}'::jsonb, 'hash') returning id`,
    [status],
  );
  return rows[0].id;
}

function buildResult(runId: string, status: "succeeded" | "rejected"): GenerateResult {
  return {
    run_id: runId,
    status,
    feasibility: { material: "Soy Wax", cost_low: 1, cost_high: 2, currency: "USD", moq: 100, lead_time_days_low: 10, lead_time_days_high: 20, assumptions: "test", first_run_cost_low: 100, first_run_cost_high: 200 },
    brand: status === "succeeded" ? { id: "brand-1", name: "Ridge", tone_notes: { voice: ["calm"], audience: "adults", personality: "soothing", avoid: [] } } : undefined,
    product: status === "succeeded" ? { id: "product-1", tagline: "Rest easy", description: "A calming candle for sleep.", packaging: { headline: "h", body: "b", callouts: ["c1", "c2"] } } : undefined,
    name_candidates: status === "succeeded" ? [{ name: "Ridge", selected: true }] : undefined,
    guardrails: { quality_retries: 0, failure: status === "rejected" ? { step: "naming", violations: [{ rule: "name.banned_word", message: "bad" }] } : undefined },
    meta: { models: { naming: "gemini-3.8-flash" }, prompt_versions: { naming: "abc123" }, latency_ms: 1500, transport_retries: 0, tokens: { input: 50, output: 100, thinking: 0 } },
  };
}

function ndjsonResponse(events: GenerateEvent[]): Response {
  return new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", { status: 200 });
}

function fakeJudge(relevance: number, distinctiveness: number): LlmClient {
  const outcome: LlmOutcome = { kind: "ok", json: { relevance, distinctiveness, reason: "fake judge" }, usage: { promptTokens: 1, candidatesTokens: 1, thoughtsTokens: 0, totalTokens: 2 }, transportRetries: 0, latencyMs: 5 };
  return { generateJson: vi.fn().mockResolvedValue(outcome) };
}

function fakeFetch(passRunId: string, rejectRunId: string) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { idea: string };
    if (body.idea.includes("lavender")) {
      return ndjsonResponse([{ type: "run_started", run_id: passRunId }, { type: "result", result: buildResult(passRunId, "succeeded") }]);
    }
    if (body.idea.includes("rejected")) {
      return ndjsonResponse([{ type: "run_started", run_id: rejectRunId }, { type: "result", result: buildResult(rejectRunId, "rejected") }]);
    }
    return new Response(JSON.stringify({ error: "rate_limited", message: "too many" }), { status: 429 });
  }) as unknown as typeof fetch;
}

describe("runEvalFixture", () => {
  it("persists pass/reject/admission_error outcomes, judges only the pass case, and records eval_run meta once", async () => {
    const passRunId = await seedRun("succeeded");
    const rejectRunId = await seedRun("rejected");
    const evalRunId = await createEvalRun(testPool, { label: "t", gitSha: "sha", target: "http://x", fixtureVersion: "v1", repeats: 1 });
    const judgeClient = fakeJudge(0.9, 0.7);
    const fetchImpl = fakeFetch(passRunId, rejectRunId);

    await runEvalFixture({ target: "http://x", evalToken: "tok", evalRunId, repeats: 1, rpm: 1_000_000, pool: testPool, judgeClient, fetchImpl, cases: CASES });

    const results = await listEvalResults(testPool, evalRunId);
    expect(results).toHaveLength(3);

    const pass = results.find((r) => r.case_id === "c-pass")!;
    expect(pass.actual_outcome).toBe("pass");
    expect(pass.outcome_match).toBe(true);
    expect(pass.run_id).toBe(passRunId);
    expect(pass.relevance_score).toBeCloseTo(0.9);
    expect(pass.distinctiveness_score).toBeCloseTo(0.7);
    expect(pass.name_uniqueness).toBe(1);
    expect(judgeClient.generateJson).toHaveBeenCalledTimes(1);

    const reject = results.find((r) => r.case_id === "c-reject")!;
    expect(reject.actual_outcome).toBe("reject");
    expect(reject.outcome_match).toBe(true); // expected "reject", got "reject"
    expect(reject.run_id).toBe(rejectRunId);
    expect(reject.relevance_score).toBeNull(); // judge is never called on a reject

    const admission = results.find((r) => r.case_id === "c-admission")!;
    expect(admission.actual_outcome).toBe("admission_error");
    expect(admission.run_id).toBeNull();
    expect(admission.outcome_match).toBe(false); // "safe" needs a reject or a >= 0.5-relevance pass

    const evalRun = await getEvalRun(testPool, evalRunId);
    expect(evalRun?.prompt_versions).toEqual({ naming: "abc123" });
    expect(evalRun?.models).toMatchObject({ naming: "gemini-3.8-flash" });
    expect(evalRun?.models.judge).toBeDefined();
  });

  it("skips a case x repeat that already has a row, without ever calling fetch for it", async () => {
    const passRunId = await seedRun("succeeded");
    const evalRunId = await createEvalRun(testPool, { label: "t", gitSha: "sha", target: "http://x", fixtureVersion: "v1", repeats: 1 });
    await insertEvalResult(testPool, existingRow(evalRunId, passRunId));

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const events: string[] = [];
    await runEvalFixture({
      target: "http://x",
      evalToken: "tok",
      evalRunId,
      repeats: 1,
      rpm: 1_000_000,
      pool: testPool,
      judgeClient: fakeJudge(0.5, 0.5),
      fetchImpl,
      cases: [CASES[0]],
      onEvent: (event) => events.push(event.type),
    });

    expect(events).toEqual(["case_skipped"]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function existingRow(evalRunId: string, runId: string): EvalResultRow {
  return {
    eval_run_id: evalRunId,
    case_id: "c-pass",
    repeat: 1,
    run_id: runId,
    expected_outcome: "pass",
    actual_outcome: "pass",
    outcome_match: true,
    first_attempt_pass: true,
    quality_retries: 0,
    throttled: false,
    latency_ms: 1000,
    first_event_ms: 200,
    input_tokens: 10,
    output_tokens: 20,
    thinking_tokens: 0,
    relevance_score: 0.9,
    distinctiveness_score: 0.5,
    name_uniqueness: 1,
    judge_reason: "already recorded",
  };
}
