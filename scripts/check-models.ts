import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config({ path: ".env.local" });

// Confirms MODEL_STRONG and MODEL_CHEAP (TRD.md §6 [D12]) are both available on the configured
// key before the app relies on them at request time. Branches the same way
// lib/adapters/createLlmClient.ts does (D26) — LLM_PROVIDER=qwen checks against Groq instead of
// Gemini, since the two providers need different verification calls (no shared "get model" API).
async function main() {
  if (process.env.LLM_PROVIDER === "qwen") {
    await checkQwenModels();
  } else {
    await checkGeminiModels();
  }
}

async function checkGeminiModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const modelStrong = process.env.MODEL_STRONG ?? "gemini-3.8-flash";
  const modelCheap = process.env.MODEL_CHEAP ?? "gemini-3.5-flash-lite";

  const ai = new GoogleGenAI({ apiKey });
  let failed = false;

  for (const [label, model] of [
    ["MODEL_STRONG", modelStrong],
    ["MODEL_CHEAP", modelCheap],
  ] as const) {
    try {
      await ai.models.get({ model });
      console.log(`OK   ${label}=${model}`);
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`FAIL ${label}=${model}: ${message}`);
    }
  }

  if (failed) process.exit(1);
}

async function checkQwenModels() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");

  const modelStrong = process.env.MODEL_STRONG ?? "qwen/qwen3.8-27b";
  const modelCheap = process.env.MODEL_CHEAP ?? "qwen/qwen3.8-27b";

  let failed = false;

  for (const [label, model] of [
    ["MODEL_STRONG", modelStrong],
    ["MODEL_CHEAP", modelCheap],
  ] as const) {
    try {
      // No shared "get model" endpoint on Groq's OpenAI-compatible API — a 1-token completion
      // is the cheapest real call that actually exercises the configured model id.
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${response.status} ${body}`);
      }
      console.log(`OK   ${label}=${model}`);
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`FAIL ${label}=${model}: ${message}`);
    }
  }

  if (failed) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
