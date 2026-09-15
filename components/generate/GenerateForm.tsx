"use client";

import { useEffect, useState } from "react";
import { IDEA_LENGTH } from "@/config/limits";
import type { CategorySummary } from "@/lib/contracts/catalog";
import type { GenerateRequest } from "@/lib/contracts/generate";

interface GenerateFormProps {
  disabled: boolean;
  onSubmit: (request: GenerateRequest) => void;
}

export function GenerateForm({ disabled, onSubmit }: GenerateFormProps) {
  const [categories, setCategories] = useState<CategorySummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categorySlug, setCategorySlug] = useState("");
  const [optionId, setOptionId] = useState("");
  const [idea, setIdea] = useState("");

  useEffect(() => {
    fetch("/api/categories")
      .then((res) => res.json())
      .then((body: { categories: CategorySummary[] }) => {
        setCategories(body.categories);
        const first = body.categories[0];
        if (first) {
          setCategorySlug(first.slug);
          setOptionId(first.options.find((o) => o.is_default)?.id ?? first.options[0]?.id ?? "");
        }
      })
      .catch(() => setLoadError("Could not load categories."));
  }, []);

  const category = categories?.find((c) => c.slug === categorySlug);

  function handleCategoryChange(slug: string) {
    setCategorySlug(slug);
    const next = categories?.find((c) => c.slug === slug);
    setOptionId(next?.options.find((o) => o.is_default)?.id ?? next?.options[0]?.id ?? "");
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onSubmit({ idea, category: categorySlug, feasibility_option_id: optionId || undefined });
  }

  if (loadError) return <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>;
  if (!categories) return <p className="text-sm text-zinc-500">Loading categories…</p>;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-xl">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Category</span>
        <select
          value={categorySlug}
          onChange={(e) => handleCategoryChange(e.target.value)}
          disabled={disabled}
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.display_name}
            </option>
          ))}
        </select>
      </label>

      {category && category.options.length > 1 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Material</span>
          <select
            value={optionId}
            onChange={(e) => setOptionId(e.target.value)}
            disabled={disabled}
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {category.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.material}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Product idea</span>
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          disabled={disabled}
          minLength={IDEA_LENGTH.min}
          maxLength={IDEA_LENGTH.max}
          rows={3}
          required
          placeholder="e.g. a reusable water bottle for hikers that keeps drinks cold all day"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <span className="text-xs text-zinc-500">
          {idea.length}/{IDEA_LENGTH.max} characters (min {IDEA_LENGTH.min})
        </span>
      </label>

      <p className="text-xs text-zinc-500">
        Your IP address is hashed and used only to enforce generation rate limits — it isn&apos;t stored in the clear. If your
        generation succeeds, the idea and resulting brand may appear in the public gallery.
      </p>

      <button
        type="submit"
        disabled={disabled || idea.trim().length < IDEA_LENGTH.min || !categorySlug}
        className="self-start rounded bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {disabled ? "Generating…" : "Generate"}
      </button>
    </form>
  );
}
