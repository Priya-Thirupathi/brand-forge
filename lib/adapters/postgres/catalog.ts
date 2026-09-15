import type { Pool } from "pg";
import type { CategorySummary, FeasibilityOptionSummary } from "@/lib/contracts/catalog";
import type { CategoryFacts } from "@/lib/domain/types";
import { firstRunCash } from "@/lib/domain/feasibility";

interface CategoryRow {
  slug: string;
  display_name: string;
  sort_order: number;
}

interface OptionRow {
  id: string;
  category: string;
  material: string;
  material_terms: string[];
  cost_low: number;
  cost_high: number;
  currency: string;
  moq: number;
  lead_time_days_low: number;
  lead_time_days_high: number;
  assumptions: string;
  is_default: boolean;
}

// TRD.md §8 GET /api/categories: every category with its options, plus first-run cash
// (lib/domain/feasibility.ts) computed here rather than stored.
export async function listCategories(pool: Pool): Promise<CategorySummary[]> {
  const [{ rows: categoryRows }, { rows: optionRows }] = await Promise.all([
    pool.query<CategoryRow>("select slug, display_name, sort_order from categories order by sort_order"),
    pool.query<OptionRow>(
      `select id, category, material, material_terms,
              cost_low::float8 as cost_low, cost_high::float8 as cost_high,
              currency, moq, lead_time_days_low, lead_time_days_high, assumptions, is_default
       from feasibility_options
       order by category, is_default desc, material`,
    ),
  ]);

  const optionsByCategory = new Map<string, FeasibilityOptionSummary[]>();
  for (const row of optionRows) {
    const summary: FeasibilityOptionSummary = {
      id: row.id,
      material: row.material,
      material_terms: row.material_terms,
      cost_low: row.cost_low,
      cost_high: row.cost_high,
      currency: row.currency,
      moq: row.moq,
      lead_time_days_low: row.lead_time_days_low,
      lead_time_days_high: row.lead_time_days_high,
      assumptions: row.assumptions,
      is_default: row.is_default,
      first_run_cash: firstRunCash({ moq: row.moq, costLow: row.cost_low, costHigh: row.cost_high }),
    };
    const existing = optionsByCategory.get(row.category);
    if (existing) existing.push(summary);
    else optionsByCategory.set(row.category, [summary]);
  }

  return categoryRows.map((row) => ({
    slug: row.slug,
    display_name: row.display_name,
    sort_order: row.sort_order,
    options: optionsByCategory.get(row.slug) ?? [],
  }));
}

// POST /api/generate resolves the request's `category` to trusted prompt facts (TRD.md §5)
// before any generation call is made — a category not in this table is a 400, not a run.
export async function findCategory(pool: Pool, slug: string): Promise<CategoryFacts | null> {
  const { rows } = await pool.query<{ slug: string; display_name: string; keywords: string[] }>(
    "select slug, display_name, keywords from categories where slug = $1",
    [slug],
  );
  const row = rows[0];
  return row ? { slug: row.slug, displayName: row.display_name, keywords: row.keywords } : null;
}
