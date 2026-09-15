import type { Violation } from "@/lib/contracts/violation";
import { TAGLINE_WORDS, DESCRIPTION_WORDS, TONE } from "@/config/limits";
import { countWords, containsWholeTerm } from "./normalize";
import type { CategoryFacts } from "../types";

export interface TaglineDescriptionOutput {
  tagline: string;
  description: string;
  tone_notes: {
    voice: string[];
    audience: string;
    personality: string;
    avoid: string[];
  };
}

// tagline.length, description.length, description.category, tone.shape (TRD.md §7).
export function checkTaglineDescriptionShapeRules(
  output: TaglineDescriptionOutput,
  category: CategoryFacts,
): Violation[] {
  const violations: Violation[] = [];

  const taglineWords = countWords(output.tagline);
  if (taglineWords < TAGLINE_WORDS.min || taglineWords > TAGLINE_WORDS.max) {
    violations.push({
      rule: "tagline.length",
      message: `tagline has ${taglineWords} words, expected ${TAGLINE_WORDS.min}-${TAGLINE_WORDS.max}`,
    });
  }

  const descriptionWords = countWords(output.description);
  if (descriptionWords < DESCRIPTION_WORDS.min || descriptionWords > DESCRIPTION_WORDS.max) {
    violations.push({
      rule: "description.length",
      message: `description has ${descriptionWords} words, expected ${DESCRIPTION_WORDS.min}-${DESCRIPTION_WORDS.max}`,
    });
  }

  const mentionsCategory = category.keywords.some((keyword) =>
    containsWholeTerm(output.description, keyword),
  );
  if (!mentionsCategory) {
    violations.push({ rule: "description.category", message: "description doesn't mention the category" });
  }

  const { voice, audience, personality, avoid } = output.tone_notes;
  if (voice.length < TONE.voiceItems.min || voice.length > TONE.voiceItems.max) {
    violations.push({
      rule: "tone.shape",
      message: `tone_notes.voice has ${voice.length} items, expected ${TONE.voiceItems.min}-${TONE.voiceItems.max}`,
    });
  }
  if (countWords(audience) > TONE.audienceMaxWords) {
    violations.push({ rule: "tone.shape", message: `tone_notes.audience exceeds ${TONE.audienceMaxWords} words` });
  }
  if (countWords(personality) > TONE.personalityMaxWords) {
    violations.push({
      rule: "tone.shape",
      message: `tone_notes.personality exceeds ${TONE.personalityMaxWords} words`,
    });
  }
  if (avoid.length > TONE.avoidItems.max) {
    violations.push({
      rule: "tone.shape",
      message: `tone_notes.avoid has ${avoid.length} items, expected at most ${TONE.avoidItems.max}`,
    });
  }

  return violations;
}
