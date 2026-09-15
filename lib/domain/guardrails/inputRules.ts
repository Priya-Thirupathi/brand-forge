import type { Violation } from "@/lib/contracts/violation";
import { BANNED_WORDS } from "@/config/bannedWords";
import { containsWholeTerm } from "./normalize";

// input.banned_word (TRD.md §7): the idea itself, before any generation call is made.
// input.safety (Gemini blocking the prompt) isn't checked here — it's only known once an
// LlmOutcome comes back, so the service layer maps it directly from `prompt_blocked`.
export function checkBannedWordInIdea(idea: string): Violation[] {
  for (const word of BANNED_WORDS) {
    if (containsWholeTerm(idea, word)) {
      return [{ rule: "input.banned_word", message: `idea contains a banned word: "${word}"` }];
    }
  }
  return [];
}
