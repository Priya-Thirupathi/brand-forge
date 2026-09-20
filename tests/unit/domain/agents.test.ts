import { describe, expect, it } from "vitest";
import { z } from "zod";
import { namingAgent } from "@/lib/domain/agents/naming";
import { taglineDescriptionAgent } from "@/lib/domain/agents/taglineDescription";
import { packagingAgent } from "@/lib/domain/agents/packaging";
import type { CategoryFacts, FeasibilityOptionFacts } from "@/lib/domain/types";

const UNSUPPORTED_JSON_SCHEMA_KEYWORDS = [
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
];

function assertNoUnsupportedKeywords(schema: unknown): void {
  if (Array.isArray(schema)) {
    schema.forEach(assertNoUnsupportedKeywords);
    return;
  }
  if (schema !== null && typeof schema === "object") {
    for (const key of Object.keys(schema)) {
      expect(UNSUPPORTED_JSON_SCHEMA_KEYWORDS).not.toContain(key);
      assertNoUnsupportedKeywords((schema as Record<string, unknown>)[key]);
    }
  }
}

describe("agent output schemas convert to Gemini-supported JSON Schema", () => {
  it.each([
    ["naming", namingAgent],
    ["tagline_description", taglineDescriptionAgent],
    ["packaging", packagingAgent],
  ] as const)("%s uses only supported keywords", (_name, agent) => {
    assertNoUnsupportedKeywords(z.toJSONSchema(agent.outputSchema));
  });
});

const category: CategoryFacts = {
  slug: "pet_treats",
  displayName: "Pet Treats",
  keywords: ["pet treat", "pet treats", "treat", "treats", "dog treat", "dog treats"],
};

const option: FeasibilityOptionFacts = {
  material: "Recyclable Stand-Up Pouch",
  materialTerms: ["paper pouch", "recyclable pouch", "kraft"],
  costLow: 0.4,
  costHigh: 0.6,
  currency: "USD",
  moq: 3000,
  leadTimeDaysLow: 25,
  leadTimeDaysHigh: 35,
  assumptions: "illustrative",
};

describe("namingAgent.evaluate", () => {
  const input = { idea: "grain-free training treats for small dogs", category, option };

  it("accepts 3 distinct, well-formed, original candidates", () => {
    const result = namingAgent.evaluate(
      {
        candidates: [
          { name: "Wagwell", rationale: "friendly and warm" },
          { name: "Barkline", rationale: "playful" },
          { name: "Pet Treats", rationale: "descriptive but fails category rule" },
        ],
      },
      input,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accepted.selectedName).toBe("Wagwell");
    }
  });

  it("rejects when the candidate count is wrong", () => {
    const result = namingAgent.evaluate({ candidates: [{ name: "Wagwell", rationale: "r" }] }, input);
    expect(result.ok).toBe(false);
  });

  it("rejects when every candidate fails per-candidate rules", () => {
    const result = namingAgent.evaluate(
      {
        candidates: [
          { name: "Pet Treats", rationale: "r" },
          { name: "Treats", rationale: "r" },
          { name: "Dog Treats", rationale: "r" },
        ],
      },
      input,
    );
    expect(result.ok).toBe(false);
  });
});

describe("taglineDescriptionAgent.evaluate", () => {
  const input = {
    idea: "grain-free training treats for small dogs",
    category,
    option,
    brandName: "Wagwell",
  };

  it("accepts well-formed, accurate copy", () => {
    const result = taglineDescriptionAgent.evaluate(
      {
        tagline: "Small treats, big trust",
        description:
          "Wagwell makes grain-free training treats sized for small dogs and big training sessions. " +
          "Every treat is baked in small batches with real, recognizable ingredients — no fillers, no " +
          "mystery meat, just something worth working for. Packed in a recyclable pouch, shipped fast, " +
          "and made for dogs who deserve better snacks during every walk and every trick they learn.",
        tone_notes: {
          voice: ["warm", "playful", "trustworthy"],
          audience: "small-dog owners who train with treats",
          personality: "an encouraging trainer, not a lecture",
          avoid: ["corporate jargon"],
        },
      },
      input,
    );
    expect(result.ok).toBe(true);
  });

  it("substitutes the existing brand's tone_notes for a follow-up, ignoring whatever the model returned (D29)", () => {
    const existingToneNotes = {
      voice: ["rugged", "direct"],
      audience: "trail runners",
      personality: "a no-nonsense outdoor guide",
      avoid: ["corporate jargon"],
    };
    const result = taglineDescriptionAgent.evaluate(
      {
        tagline: "Small treats, big trust",
        description:
          "Wagwell makes grain-free training treats sized for small dogs and big training sessions. " +
          "Every treat is baked in small batches with real, recognizable ingredients — no fillers, no " +
          "mystery meat, just something worth working for. Packed in a recyclable pouch, shipped fast, " +
          "and made for dogs who deserve better snacks during every walk and every trick they learn.",
        tone_notes: { voice: ["completely", "different", "tone"], audience: "a", personality: "b", avoid: [] },
      },
      { ...input, existingToneNotes },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accepted.tone_notes).toEqual(existingToneNotes);
    }
  });

  it("ignores a shape violation in the model's own tone_notes for a follow-up, since it's discarded anyway", () => {
    const existingToneNotes = {
      voice: ["rugged", "direct"],
      audience: "trail runners",
      personality: "a no-nonsense outdoor guide",
      avoid: ["corporate jargon"],
    };
    const result = taglineDescriptionAgent.evaluate(
      {
        tagline: "Small treats, big trust",
        description:
          "Wagwell makes grain-free training treats sized for small dogs and big training sessions. " +
          "Every treat is baked in small batches with real, recognizable ingredients — no fillers, no " +
          "mystery meat, just something worth working for. Packed in a recyclable pouch, shipped fast, " +
          "and made for dogs who deserve better snacks during every walk and every trick they learn.",
        // Too few voice words (1, not 3-5) — would fail tone.shape on a fresh brand.
        tone_notes: { voice: ["a"], audience: "", personality: "", avoid: [] },
      },
      { ...input, existingToneNotes },
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a regulated health claim", () => {
    const result = taglineDescriptionAgent.evaluate(
      {
        tagline: "Treats that cures anxiety",
        description:
          "Wagwell treats cures anxiety in dogs while training small dogs with real ingredients baked in " +
          "small batches, packed for freshness, shipped fast, and made for every walk, every trick, and " +
          "every treat-worthy moment your dog earns during a long and happy training journey together.",
        tone_notes: {
          voice: ["warm", "playful", "trustworthy"],
          audience: "small-dog owners who train with treats",
          personality: "an encouraging trainer, not a lecture",
          avoid: ["corporate jargon"],
        },
      },
      input,
    );
    expect(result.ok).toBe(false);
  });
});

describe("packagingAgent.evaluate", () => {
  const input = {
    idea: "grain-free training treats for small dogs",
    category,
    option,
    brandName: "Wagwell",
    tagline: "Small treats, big trust",
    description: "d",
    toneNotes: { voice: ["warm"], audience: "a", personality: "b", avoid: [] },
  };

  it("accepts well-formed packaging copy", () => {
    const result = packagingAgent.evaluate(
      {
        headline: "Wagwell training treats",
        body:
          "Baked in small batches with real, recognizable ingredients, Wagwell treats are sized for " +
          "training small dogs — no fillers, no mystery meat, just something worth working for on every walk.",
        callouts: ["Small-batch baked", "Real ingredients only"],
      },
      input,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects packaging missing the brand name", () => {
    const result = packagingAgent.evaluate(
      {
        headline: "Training treats",
        body:
          "Baked in small batches with real, recognizable ingredients, these treats are sized for " +
          "training small dogs — no fillers, no mystery meat, just something worth working for on every walk.",
        callouts: ["Small-batch baked", "Real ingredients only"],
      },
      input,
    );
    expect(result.ok).toBe(false);
  });
});
