"use client";

import { useEffect, useState } from "react";
import type { CategorySummary } from "@/lib/contracts/catalog";
import type { GalleryProduct } from "@/lib/contracts/gallery";
import { Gallery } from "./Gallery";

export function GalleryTab() {
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [categorySlug, setCategorySlug] = useState("");
  const [products, setProducts] = useState<GalleryProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/categories")
      .then((res) => res.json())
      .then((body: { categories: CategorySummary[] }) => setCategories(body.categories))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (categorySlug) params.set("category", categorySlug);
    fetch(`/api/products?${params}`)
      .then((res) => res.json())
      .then((body: { products: GalleryProduct[] }) => setProducts(body.products))
      .catch(() => setError("Could not load the gallery."));
  }, [categorySlug]);

  function handleCategoryChange(slug: string) {
    setCategorySlug(slug);
    setProducts(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium">Category</span>
        <select
          value={categorySlug}
          onChange={(e) => handleCategoryChange(e.target.value)}
          className="rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">All</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.display_name}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!error && !products && <p className="text-sm text-zinc-500">Loading…</p>}
      {products && <Gallery products={products} />}
    </div>
  );
}
