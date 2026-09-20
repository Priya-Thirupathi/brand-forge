import { createGeminiClient } from "./gemini/client";
import { createQwenClient } from "./qwen/client";
import type { LlmClient } from "@/lib/services/ports";

// D26 (revised 2026-09-20): LLM_PROVIDER=qwen selects Groq's Qwen adapter in any
// environment, including a deployed build — no longer gated to non-production. Originally added
// as a local-only escape hatch to avoid burning Gemini's free-tier daily quota while testing;
// now also the production default, for the same reason (Gemini's daily quota kept getting
// exhausted mid-session, including in the deployed demo). Gemini stays available as the other
// LlmClient implementation — unset LLM_PROVIDER (or set it to anything but "qwen") to use
// it instead. Shared by app/api/generate/route.ts and lib/eval/judge.ts (Stage 2) so the two
// call sites can't drift.
export function createLlmClient(): LlmClient {
  if (process.env.LLM_PROVIDER === "qwen") {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is not set");
    return createQwenClient(apiKey);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return createGeminiClient(apiKey);
}
