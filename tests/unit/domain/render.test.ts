import { describe, expect, it } from "vitest";
import { renderTemplate } from "@/lib/domain/prompts/render";

describe("renderTemplate", () => {
  it("substitutes placeholders", () => {
    expect(renderTemplate("Hello {{name}}, welcome to {{place}}", { name: "Ada", place: "Dough" })).toBe(
      "Hello Ada, welcome to Dough",
    );
  });

  it("throws on a missing variable", () => {
    expect(() => renderTemplate("Hello {{name}}", {})).toThrow(/name/);
  });
});
