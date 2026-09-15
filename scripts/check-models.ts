import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config({ path: ".env.local" });

// Confirms MODEL_STRONG and MODEL_CHEAP (TRD.md §6 [D12]) are both available on the
// configured key before the app relies on them at request time.
async function main() {
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
