import { describe, expect, it } from "vitest";
import { GenerateRequestSchema, GenerateResultSchema } from "@/lib/contracts/generate";

describe("GenerateRequestSchema", () => {
  it("accepts a valid request with no feasibility_option_id", () => {
    const result = GenerateRequestSchema.safeParse({ idea: "a reusable water bottle for hikers", category: "water_bottle" });
    expect(result.success).toBe(true);
  });

  it("accepts a valid uuid feasibility_option_id", () => {
    const result = GenerateRequestSchema.safeParse({
      idea: "a reusable water bottle for hikers",
      category: "water_bottle",
      feasibility_option_id: "2b7cf083-619d-4df9-86f1-4e179579f2e5",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an idea shorter than IDEA_LENGTH.min", () => {
    const result = GenerateRequestSchema.safeParse({ idea: "too short", category: "water_bottle" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid feasibility_option_id", () => {
    const result = GenerateRequestSchema.safeParse({
      idea: "a reusable water bottle for hikers",
      category: "water_bottle",
      feasibility_option_id: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

describe("GenerateResultSchema", () => {
  it("accepts a succeeded result with a partial (not exhaustive) meta.models", () => {
    const result = GenerateResultSchema.safeParse({
      run_id: "run-1",
      status: "succeeded",
      feasibility: {
        material: "Stainless Steel",
        cost_low: 3.2,
        cost_high: 4.8,
        currency: "USD",
        moq: 500,
        lead_time_days_low: 35,
        lead_time_days_high: 50,
        assumptions: "test",
        first_run_cost_low: 1600,
        first_run_cost_high: 2400,
      },
      brand: { id: "brand-1", name: "Ridge", tone_notes: { voice: ["bold"], audience: "hikers", personality: "rugged", avoid: [] } },
      product: { id: "product-1", tagline: "Built for the trail", description: "d".repeat(50), packaging: { headline: "h", body: "b", callouts: [] } },
      name_candidates: [{ name: "Ridge", selected: true }],
      guardrails: { quality_retries: 0 },
      meta: {
        // Only naming ran — tagline_description/packaging are legitimately absent, not just
        // empty strings (TRD.md §8's Record<StepName,string> would wrongly forbid this).
        models: { naming: "gemini-3.8-flash" },
        prompt_versions: { naming: "abc123" },
        latency_ms: 1200,
        transport_retries: 0,
        tokens: { input: 10, output: 20, thinking: 5 },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a result missing the required guardrails field", () => {
    const result = GenerateResultSchema.safeParse({ run_id: "run-1", status: "rejected" });
    expect(result.success).toBe(false);
  });
});
