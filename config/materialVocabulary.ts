// Starter list — NOT curated, flagged for review. Base material categories only (no
// "recycled X" / "X-free X" / subtype compounds like "bpa-free plastic" or "stainless steel")
// — those caused false positives, since they're specific to one feasibility option's exact
// wording but were being scanned against every option's copy. `copy.material`
// (lib/domain/guardrails/copyRules.ts) checks each mention against a specific option's true
// `material_terms` (db/seed.sql) rather than against this list directly — this is just the
// set of terms worth scanning for. Trade-off: a false "recycled aluminum" claim on a virgin-
// aluminum option no longer gets caught, only a false "aluminum" claim on a non-aluminum one.
export const MATERIAL_VOCABULARY: readonly string[] = [
  "plastic",
  "aluminum",
  "metal",
  "steel",
  "glass",
  "cotton",
  "polyester",
  "canvas",
  "wool",
  "leather",
  "wood",
  "bamboo",
  "paper",
  "foil",
  "mylar",
  "gelatin",
  "wax",
];
