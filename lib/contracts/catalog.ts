import { z } from "zod";

// TRD.md §8 GET /api/categories: categories with their options, plus computed first-run cash
// (lib/domain/feasibility.ts — computed on the fly, never stored, so it rides along here
// rather than getting its own column).
export const FeasibilityOptionSummarySchema = z.object({
  id: z.string(),
  material: z.string(),
  material_terms: z.array(z.string()),
  cost_low: z.number(),
  cost_high: z.number(),
  currency: z.string(),
  moq: z.number(),
  lead_time_days_low: z.number(),
  lead_time_days_high: z.number(),
  assumptions: z.string(),
  is_default: z.boolean(),
  first_run_cash: z.object({ low: z.number(), high: z.number() }),
});
export type FeasibilityOptionSummary = z.infer<typeof FeasibilityOptionSummarySchema>;

export const CategorySummarySchema = z.object({
  slug: z.string(),
  display_name: z.string(),
  sort_order: z.number(),
  options: z.array(FeasibilityOptionSummarySchema),
});
export type CategorySummary = z.infer<typeof CategorySummarySchema>;

export const CategoriesResponseSchema = z.object({ categories: z.array(CategorySummarySchema) });
