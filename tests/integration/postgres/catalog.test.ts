import { beforeEach, describe, expect, it } from "vitest";
import { findCategory, listCategories } from "@/lib/adapters/postgres/catalog";
import { resetDb, seedCategory, testPool, type SeededCategory } from "../setup/testDb";

let category: SeededCategory;

beforeEach(async () => {
  await resetDb();
  category = await seedCategory();
});

describe("listCategories", () => {
  it("returns each category with its options and computed first-run cash", async () => {
    const categories = await listCategories(testPool);

    expect(categories).toHaveLength(1);
    expect(categories[0].slug).toBe(category.category);
    expect(categories[0].options).toHaveLength(2);

    const defaultOption = categories[0].options.find((option) => option.id === category.defaultOptionId);
    expect(defaultOption).toMatchObject({ material: "Stainless Steel", is_default: true });
    // TRD.md §3: first-run cash = moq × cost_low … moq × cost_high.
    expect(defaultOption?.first_run_cash).toEqual({ low: 1600, high: 2400 });
  });

  it("returns an empty options array for a category with none", async () => {
    await testPool.query("insert into categories (slug, display_name, keywords, sort_order) values ('candle', 'Candle', array['candle'], 2)");

    const categories = await listCategories(testPool);
    const candle = categories.find((c) => c.slug === "candle");
    expect(candle?.options).toEqual([]);
  });
});

describe("findCategory", () => {
  it("returns the category's trusted prompt facts", async () => {
    const found = await findCategory(testPool, category.category);
    expect(found).toEqual({ slug: "water_bottle", displayName: "Water Bottle", keywords: ["water bottle", "bottle"] });
  });

  it("returns null for an unknown slug", async () => {
    expect(await findCategory(testPool, "not_a_real_category")).toBeNull();
  });
});
