// Numeric constraints enforced by guardrail rules (TRD.md §7). Zod schemas describe shape
// only [D17] — every length/count bound lives here, not in a Zod schema.

export const IDEA_LENGTH = { min: 10, max: 300 } as const;

export const NAME = {
  count: 3,
  words: { min: 1, max: 3 },
  chars: { min: 2, max: 24 },
} as const;

export const TAGLINE_WORDS = { min: 3, max: 10 } as const;
export const DESCRIPTION_WORDS = { min: 40, max: 120 } as const;

export const TONE = {
  voiceItems: { min: 3, max: 5 },
  audienceMaxWords: 20,
  personalityMaxWords: 30,
  avoidItems: { max: 5 },
} as const;

export const PACKAGING = {
  headlineMaxWords: 8,
  bodyWords: { min: 20, max: 80 },
  callouts: { min: 2, max: 4 },
  calloutMaxWords: 6,
} as const;
