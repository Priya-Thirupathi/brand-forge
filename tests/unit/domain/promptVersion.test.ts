import { describe, expect, it } from "vitest";
import { computePromptVersion } from "@/lib/domain/prompts/promptVersion";

describe("computePromptVersion", () => {
  it("is stable for the same inputs", () => {
    const a = computePromptVersion("system", "user", { type: "object" });
    const b = computePromptVersion("system", "user", { type: "object" });
    expect(a).toBe(b);
  });

  it("changes when the system template changes", () => {
    const a = computePromptVersion("system v1", "user", { type: "object" });
    const b = computePromptVersion("system v2", "user", { type: "object" });
    expect(a).not.toBe(b);
  });

  it("changes when the schema changes", () => {
    const a = computePromptVersion("system", "user", { type: "object" });
    const b = computePromptVersion("system", "user", { type: "array" });
    expect(a).not.toBe(b);
  });

  it("is 12 hex characters", () => {
    const version = computePromptVersion("system", "user", {});
    expect(version).toMatch(/^[0-9a-f]{12}$/);
  });
});
