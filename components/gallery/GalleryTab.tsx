"use client";

import { useEffect, useState } from "react";
import type { CategorySummary } from "@/lib/contracts/catalog";
import type { GalleryProduct } from "@/lib/contracts/gallery";
import type { FollowUpTarget } from "@/components/generate/GenerateTab";
import { Gallery } from "./Gallery";

interface GalleryTabProps {
  onFollowUp: (target: FollowUpTarget) => void;
}

export function GalleryTab({ onFollowUp }: GalleryTabProps) {
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
    <div className="flex flex-col gap-5">
      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium">Category</span>
        <select
          value={categorySlug}
          onChange={(e) => handleCategoryChange(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 outline-none transition-colors focus:border-accent"
        >
          <option value="">All</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.display_name}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}
      {!error && !products && <p className="text-sm text-muted">Loading…</p>}
      {products && <Gallery products={products} onFollowUp={onFollowUp} />}
    </div>
  );
}
