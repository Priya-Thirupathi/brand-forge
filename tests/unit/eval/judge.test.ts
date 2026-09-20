import { afterEach, describe, expect, it, vi } from "vitest";
import { judgeBrand, resolveJudgeModel } from "@/lib/eval/judge";
import type { LlmClient, LlmOutcome } from "@/lib/services/ports";

function fakeClient(outcome: LlmOutcome): LlmClient {
  return { generateJson: vi.fn().mockResolvedValue(outcome) };
}

const input = { idea: "a lavender candle for people who can't sleep", category: "candle", name: "Ridge", tagline: "Rest easy", description: "A calming candle." };

describe("judgeBrand", () => {
  it("parses a valid judge response", async () => {
    const client = fakeClient({ kind: "ok", json: { relevance: 0.9, distinctiveness: 0.6, reason: "clearly a candle brand" }, usage: { promptTokens: 1, candidatesTokens: 1, thoughtsTokens: 0, totalTokens: 2 }, transportRetries: 0, latencyMs: 10 });
    const outcome = await judgeBrand(client, input, Date.now() + 5000);
    expect(outcome).toEqual({ kind: "ok", result: { relevance: 0.9, distinctiveness: 0.6, reason: "clearly a candle brand" } });
  });

  it("fails on a response that doesn't match the judge schema", async () => {
    const client = fakeClient({ kind: "ok", json: { relevance: "high" }, usage: { promptTokens: 1, candidatesTokens: 1, thoughtsTokens: 0, totalTokens: 2 }, transportRetries: 0, latencyMs: 10 });
    const outcome = await judgeBrand(client, input, Date.now() + 5000);
    expect(outcome).toEqual({ kind: "failed", reason: "invalid_json" });
  });

  it("surfaces a prompt_blocked outcome as failed", async () => {
    const client = fakeClient({ kind: "prompt_blocked", transportRetries: 0, latencyMs: 10 });
    const outcome = await judgeBrand(client, input, Date.now() + 5000);
    expect(outcome).toEqual({ kind: "failed", reason: "prompt_blocked" });
  });

  it("surfaces a transport failure's error as the reason", async () => {
    const client = fakeClient({ kind: "failed", error: "quota_exhausted", message: "daily limit", transportRetries: 0, latencyMs: 10 });
    const outcome = await judgeBrand(client, input, Date.now() + 5000);
    expect(outcome).toEqual({ kind: "failed", reason: "quota_exhausted" });
  });
});

describe("resolveJudgeModel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses JUDGE_MODEL when set, regardless of provider", () => {
    vi.stubEnv("JUDGE_MODEL", "custom-judge-model");
    expect(resolveJudgeModel()).toBe("custom-judge-model");
  });

  it("defaults to gemini-3.5-flash-lite outside local Qwen dev mode", () => {
    vi.stubEnv("JUDGE_MODEL", undefined);
    vi.stubEnv("LLM_PROVIDER", undefined);
    expect(resolveJudgeModel()).toBe("gemini-3.5-flash-lite");
  });

  it("falls back to MODEL_CHEAP in local Qwen dev mode (D26)", () => {
    vi.stubEnv("JUDGE_MODEL", undefined);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LLM_PROVIDER", "qwen");
    vi.stubEnv("MODEL_CHEAP", "qwen/qwen3.8-27b");
    expect(resolveJudgeModel()).toBe("qwen/qwen3.8-27b");
  });
});
