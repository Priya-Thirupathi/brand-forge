import { describe, expect, it } from "vitest";
import { checkTaglineDescriptionShapeRules } from "@/lib/domain/guardrails/taglineDescriptionRules";
import type { CategoryFacts } from "@/lib/domain/types";
import type { TaglineDescriptionOutput } from "@/lib/domain/guardrails/taglineDescriptionRules";

const coffeeCategory: CategoryFacts = {
  slug: "coffee_beans",
  displayName: "Coffee Beans",
  keywords: ["coffee", "coffees", "coffee bean", "coffee beans", "bean", "beans", "roast", "roasts"],
};

const validOutput: TaglineDescriptionOutput = {
  tagline: "Bold roasts, honestly sourced",
  description:
    "Every bag of coffee beans we roast starts with a relationship, not a spreadsheet. We work directly " +
    "with small farms, pay above market rate, and roast in small batches so each cup tastes like the " +
    "season it grew in. No filler, no shortcuts, just coffee worth waking up for every single morning.",
  tone_notes: {
    voice: ["warm", "direct", "confident"],
    audience: "coffee drinkers who care where their beans come from",
    personality: "a friendly farm-direct roaster, not a lecture",
    avoid: ["corporate jargon"],
  },
};

describe("checkTaglineDescriptionShapeRules", () => {
  it("passes a well-formed output", () => {
    expect(checkTaglineDescriptionShapeRules(validOutput, coffeeCategory)).toEqual([]);
  });

  it("flags a too-short tagline", () => {
    const violations = checkTaglineDescriptionShapeRules(
      { ...validOutput, tagline: "Good beans" },
      coffeeCategory,
    );
    expect(violations.map((v) => v.rule)).toContain("tagline.length");
  });

  it("flags a description that never mentions the category", () => {
    const violations = checkTaglineDescriptionShapeRules(
      {
        ...validOutput,
        description: validOutput.description.replace(/coffee|beans?|roast(s)?/gi, "product"),
      },
      coffeeCategory,
    );
    expect(violations.map((v) => v.rule)).toContain("description.category");
  });

  it("flags too few tone voice words", () => {
    const violations = checkTaglineDescriptionShapeRules(
      { ...validOutput, tone_notes: { ...validOutput.tone_notes, voice: ["warm"] } },
      coffeeCategory,
    );
    expect(violations.map((v) => v.rule)).toContain("tone.shape");
  });
});
