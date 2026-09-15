import { z } from "zod";

const PackagingSchema = z.object({
  headline: z.string(),
  body: z.string(),
  callouts: z.array(z.string()),
});

const FeasibilitySnapshotSchema = z.object({
  material: z.string(),
  material_terms: z.array(z.string()),
  cost_low: z.number(),
  cost_high: z.number(),
  currency: z.string(),
  moq: z.number(),
  lead_time_days_low: z.number(),
  lead_time_days_high: z.number(),
  assumptions: z.string(),
});

// TRD.md §8 GET /api/products: newest products with source in (user, seed), product and brand
// not hidden.
export const GalleryProductSchema = z.object({
  id: z.string(),
  brand: z.object({ id: z.string(), name: z.string() }),
  category: z.string(),
  idea: z.string(),
  tagline: z.string(),
  description: z.string(),
  packaging: PackagingSchema,
  feasibility_snapshot: FeasibilitySnapshotSchema,
  source: z.enum(["user", "seed"]),
  created_at: z.string(),
});
export type GalleryProduct = z.infer<typeof GalleryProductSchema>;

export const GalleryResponseSchema = z.object({
  products: z.array(GalleryProductSchema),
  next_cursor: z.string().nullable(),
});

const ToneNotesSchema = z.object({
  voice: z.array(z.string()),
  audience: z.string(),
  personality: z.string(),
  avoid: z.array(z.string()),
});

// TRD.md §8 GET /api/brands/:id: brand and its visible (not hidden) products.
export const BrandDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  tone_notes: ToneNotesSchema,
  products: z.array(GalleryProductSchema.omit({ brand: true })),
});
export type BrandDetail = z.infer<typeof BrandDetailSchema>;
