import type { Pool } from "pg";
import type { BrandDetail, GalleryProduct } from "@/lib/contracts/gallery";
import { decodeCursor, encodeCursor } from "../pagination";

interface ProductRow {
  id: string;
  brand_id: string;
  brand_name: string;
  category: string;
  idea: string;
  tagline: string;
  description: string;
  packaging: GalleryProduct["packaging"];
  feasibility_snapshot: GalleryProduct["feasibility_snapshot"];
  source: "user" | "seed";
  created_at: Date;
}

function toGalleryProduct(row: ProductRow): GalleryProduct {
  return { ...toBrandProduct(row), brand: { id: row.brand_id, name: row.brand_name } };
}

function toBrandProduct(row: ProductRow): Omit<GalleryProduct, "brand"> {
  return {
    id: row.id,
    category: row.category,
    idea: row.idea,
    tagline: row.tagline,
    description: row.description,
    packaging: row.packaging,
    feasibility_snapshot: row.feasibility_snapshot,
    source: row.source,
    created_at: row.created_at.toISOString(),
  };
}

const PRODUCT_COLUMNS = `
  p.id, p.brand_id, b.name as brand_name, p.category, p.idea, p.tagline, p.description,
  p.packaging, p.feasibility_snapshot, p.source, p.created_at
`;

// TRD.md §8 GET /api/products: newest products with source in (user, seed), product and brand
// not hidden, optionally scoped to a category, keyset-paginated over (created_at, id).
export async function listProducts(
  pool: Pool,
  params: { category?: string; limit: number; cursor?: string },
): Promise<{ products: GalleryProduct[]; nextCursor: string | null }> {
  const decodedCursor = params.cursor ? decodeCursor(params.cursor) : null;
  if (params.cursor && !decodedCursor) return { products: [], nextCursor: null };

  const conditions = ["p.source in ('user', 'seed')", "p.hidden = false", "b.hidden = false"];
  const values: unknown[] = [];

  if (params.category) {
    values.push(params.category);
    conditions.push(`p.category = $${values.length}`);
  }
  if (decodedCursor) {
    values.push(decodedCursor.createdAt, decodedCursor.id);
    conditions.push(`(p.created_at, p.id) < ($${values.length - 1}, $${values.length})`);
  }
  values.push(params.limit + 1);

  const { rows } = await pool.query<ProductRow>(
    `select ${PRODUCT_COLUMNS}
     from products p join brands b on b.id = p.brand_id
     where ${conditions.join(" and ")}
     order by p.created_at desc, p.id desc
     limit $${values.length}`,
    values,
  );

  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  const last = page[page.length - 1];
  return {
    products: page.map(toGalleryProduct),
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  };
}

// TRD.md §8 GET /api/brands/:id: brand and its visible (not hidden) products, regardless of
// the product's source — an eval-generated product on a visible brand still counts as one of
// its products for this detail view.
export async function getBrandWithProducts(pool: Pool, brandId: string): Promise<BrandDetail | null> {
  const { rows: brandRows } = await pool.query<{ id: string; name: string; tone_notes: BrandDetail["tone_notes"] }>(
    "select id, name, tone_notes from brands where id = $1 and hidden = false",
    [brandId],
  );
  const brand = brandRows[0];
  if (!brand) return null;

  const { rows: productRows } = await pool.query<ProductRow>(
    `select ${PRODUCT_COLUMNS}
     from products p join brands b on b.id = p.brand_id
     where p.brand_id = $1 and p.hidden = false
     order by p.created_at desc`,
    [brandId],
  );

  return {
    id: brand.id,
    name: brand.name,
    tone_notes: brand.tone_notes,
    products: productRows.map(toBrandProduct),
  };
}
