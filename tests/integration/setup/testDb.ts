import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error("TEST_DATABASE_URL is not set (see .env.local) — run migrations against it before running integration tests");
}

export const testPool = new Pool({ connectionString });

export async function resetDb(): Promise<void> {
  await testPool.query(
    "truncate table eval_results, eval_runs, run_steps, runs, products, brands, feasibility_options, categories restart identity cascade",
  );
}

export interface SeededCategory {
  category: string;
  defaultOptionId: string;
  otherOptionId: string;
}

// A category with two options (one default) — enough fixture for findOption, countRuns, and
// finishRun tests without every test file re-deriving its own category/option rows.
export async function seedCategory(): Promise<SeededCategory> {
  await testPool.query(
    "insert into categories (slug, display_name, keywords, sort_order) values ('water_bottle', 'Water Bottle', array['water bottle', 'bottle'], 1)",
  );
  const { rows } = await testPool.query<{ id: string; is_default: boolean }>(
    `insert into feasibility_options
       (category, material, material_terms, cost_low, cost_high, moq, lead_time_days_low, lead_time_days_high, assumptions, is_default)
     values
       ('water_bottle', 'Stainless Steel', array['steel', 'stainless steel'], 3.20, 4.80, 500, 35, 50, 'test fixture', true),
       ('water_bottle', 'BPA-Free Plastic', array['plastic'], 1.10, 1.70, 500, 25, 35, 'test fixture', false)
     returning id, is_default`,
  );
  const defaultOptionId = rows.find((row) => row.is_default)?.id;
  const otherOptionId = rows.find((row) => !row.is_default)?.id;
  if (!defaultOptionId || !otherOptionId) throw new Error("seedCategory: expected one default and one non-default option");
  return { category: "water_bottle", defaultOptionId, otherOptionId };
}
