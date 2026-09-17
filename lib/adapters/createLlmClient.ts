import { createGeminiClient } from "./gemini/client";
import { createQwenClient } from "./qwen/client";
import type { LlmClient } from "@/lib/services/ports";

// D26: local-dev-only escape hatch to test against Qwen (via Groq) instead of Gemini, so
// exercising a generation repeatedly doesn't burn Gemini's free-tier daily quota. D2 still
// names Gemini as the only *production* provider — the NODE_ENV check keeps this from ever
// taking effect in a deployed build even if LOCAL_LLM_PROVIDER were set by mistake. Shared by
// app/api/generate/route.ts and lib/eval/judge.ts (Stage 2) so the two call sites can't drift.
export function createLlmClient(): LlmClient {
  if (process.env.NODE_ENV !== "production" && process.env.LOCAL_LLM_PROVIDER === "qwen") {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is not set");
    return createQwenClient(apiKey);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return createGeminiClient(apiKey);
}
