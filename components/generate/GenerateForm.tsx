"use client";

import { useEffect, useState } from "react";
import { IDEA_LENGTH } from "@/config/limits";
import type { CategorySummary } from "@/lib/contracts/catalog";
import type { GenerateRequest } from "@/lib/contracts/generate";
import type { FollowUpTarget } from "./GenerateTab";

interface GenerateFormProps {
  disabled: boolean;
  onSubmit: (request: GenerateRequest) => void;
  followUpTarget: FollowUpTarget | null;
  onClearFollowUpTarget: () => void;
}

export function GenerateForm({ disabled, onSubmit, followUpTarget, onClearFollowUpTarget }: GenerateFormProps) {
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
    onSubmit({
      idea,
      category: categorySlug,
      feasibility_option_id: optionId || undefined,
      follow_up_brand_id: followUpTarget?.brandId,
    });
  }

  if (loadError) return <p className="text-sm text-danger">{loadError}</p>;
  if (!categories) return <p className="text-sm text-muted">Loading categories…</p>;

  const ideaTooShort = idea.trim().length > 0 && idea.trim().length < IDEA_LENGTH.min;

  return (
    <form onSubmit={handleSubmit} className="flex max-w-xl flex-col gap-5 rounded-xl border border-line bg-surface p-6">
      {followUpTarget && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-accent-soft-ink">
          <span>
            Adding a product to <span className="font-semibold">{followUpTarget.brandName}</span> — its established tone carries over
            unchanged.
          </span>
          <button type="button" onClick={onClearFollowUpTarget} className="shrink-0 font-medium underline underline-offset-2 hover:opacity-80">
            Switch to a new brand instead
          </button>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium">Category</span>
          <select
            value={categorySlug}
            onChange={(e) => handleCategoryChange(e.target.value)}
            disabled={disabled}
            className="rounded-lg border border-line bg-bg px-3 py-2 outline-none transition-colors focus:border-accent"
          >
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.display_name}
              </option>
            ))}
          </select>
        </label>

        {category && category.options.length > 1 && (
          <label className="flex flex-1 flex-col gap-1.5 text-sm">
            <span className="font-medium">Material</span>
            <select
              value={optionId}
              onChange={(e) => setOptionId(e.target.value)}
              disabled={disabled}
              className="rounded-lg border border-line bg-bg px-3 py-2 outline-none transition-colors focus:border-accent"
            >
              {category.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.material}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
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
          className="resize-none rounded-lg border border-line bg-bg px-3 py-2 outline-none transition-colors focus:border-accent"
        />
        <span className={`text-xs ${ideaTooShort ? "text-warning" : "text-muted"} font-mono tabular-nums`}>
          {idea.length}/{IDEA_LENGTH.max} characters (min {IDEA_LENGTH.min})
        </span>
      </label>

      <p className="text-xs leading-relaxed text-muted">
        Your idea is sent to an AI model to generate the brand copy. Your IP address is hashed and used only to enforce
        generation rate limits — it isn&apos;t stored in the clear. If your generation succeeds, the idea and resulting
        brand may appear in the public gallery.
      </p>

      <button
        type="submit"
        disabled={disabled || idea.trim().length < IDEA_LENGTH.min || !categorySlug}
        className="self-start rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {disabled ? "Generating…" : followUpTarget ? "Add product" : "Generate"}
      </button>
    </form>
  );
}
