import { beforeEach, describe, expect, it } from "vitest";
import { getBrandWithProducts, listProducts } from "@/lib/adapters/postgres/gallery";
import { resetDb, seedCategory, testPool, type SeededCategory } from "../setup/testDb";

let category: SeededCategory;

beforeEach(async () => {
  await resetDb();
  category = await seedCategory();
});

interface ProductOverrides {
  brandName?: string;
  brandHidden?: boolean;
  productHidden?: boolean;
  source?: "user" | "seed" | "eval";
  createdAt?: string;
}

async function insertProduct(overrides: ProductOverrides = {}): Promise<{ brandId: string; productId: string }> {
  const { rows: brandRows } = await testPool.query<{ id: string }>(
    `insert into brands (name, tone_notes, source, hidden, created_at)
     values ($1, '{}'::jsonb, $2, $3, coalesce($4::timestamptz, now()))
     returning id`,
    [overrides.brandName ?? "Ridge", overrides.source ?? "seed", overrides.brandHidden ?? false, overrides.createdAt ?? null],
  );
  const brandId = brandRows[0].id;

  const { rows: productRows } = await testPool.query<{ id: string }>(
    `insert into products
       (brand_id, category, feasibility_option_id, feasibility_snapshot, idea, tagline, description, packaging, source, hidden, created_at)
     values ($1, $2, $3, '{}'::jsonb, 'a reusable water bottle', 'Built for the trail', 'A steel bottle.', '{"headline":"h","body":"b","callouts":[]}'::jsonb, $4, $5, coalesce($6::timestamptz, now()))
     returning id`,
    [brandId, category.category, category.defaultOptionId, overrides.source ?? "seed", overrides.productHidden ?? false, overrides.createdAt ?? null],
  );
  return { brandId, productId: productRows[0].id };
}

describe("listProducts", () => {
  it("excludes hidden products, hidden brands, and eval-source products", async () => {
    await insertProduct({ productHidden: true });
    await insertProduct({ brandHidden: true });
    await insertProduct({ source: "eval" });
    const { productId: visibleId } = await insertProduct();

    const { products } = await listProducts(testPool, { limit: 24 });
    expect(products.map((p) => p.id)).toEqual([visibleId]);
  });

  it("scopes to a category when given", async () => {
    await testPool.query("insert into categories (slug, display_name, keywords, sort_order) values ('candle', 'Candle', array['candle'], 2)");
    await insertProduct();

    const { products } = await listProducts(testPool, { category: "candle", limit: 24 });
    expect(products).toEqual([]);
  });

  it("paginates newest-first with a cursor over (created_at, id)", async () => {
    const first = await insertProduct({ createdAt: "2026-01-01T00:00:00Z" });
    const second = await insertProduct({ createdAt: "2026-01-02T00:00:00Z" });
    const third = await insertProduct({ createdAt: "2026-01-03T00:00:00Z" });

    const page1 = await listProducts(testPool, { limit: 2 });
    expect(page1.products.map((p) => p.id)).toEqual([third.productId, second.productId]);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listProducts(testPool, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.products.map((p) => p.id)).toEqual([first.productId]);
    expect(page2.nextCursor).toBeNull();
  });

  it("returns a null cursor for a malformed cursor value instead of throwing", async () => {
    const result = await listProducts(testPool, { limit: 24, cursor: "not-a-real-cursor" });
    expect(result).toEqual({ products: [], nextCursor: null });
  });
});

describe("getBrandWithProducts", () => {
  it("returns the brand with only its visible products", async () => {
    const { brandId, productId: visibleId } = await insertProduct();
    await testPool.query(
      `insert into products
         (brand_id, category, feasibility_option_id, feasibility_snapshot, idea, tagline, description, packaging, source, hidden)
       values ($1, $2, $3, '{}'::jsonb, 'idea', 'tag', 'desc', '{"headline":"h","body":"b","callouts":[]}'::jsonb, 'seed', true)`,
      [brandId, category.category, category.defaultOptionId],
    );

    const brand = await getBrandWithProducts(testPool, brandId);
    expect(brand?.id).toBe(brandId);
    expect(brand?.products.map((p) => p.id)).toEqual([visibleId]);
  });

  it("returns null for a hidden brand", async () => {
    const { brandId } = await insertProduct({ brandHidden: true });
    expect(await getBrandWithProducts(testPool, brandId)).toBeNull();
  });

  it("returns null for an unknown id", async () => {
    expect(await getBrandWithProducts(testPool, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
