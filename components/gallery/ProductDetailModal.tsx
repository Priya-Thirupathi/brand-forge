"use client";

import { useEffect, useRef, useState } from "react";
import type { BrandDetail, GalleryProduct } from "@/lib/contracts/gallery";
import type { FollowUpTarget } from "@/components/generate/GenerateTab";
import { firstRunCash } from "@/lib/domain/feasibility";
import { Badge } from "@/components/ui/Badge";

interface ProductDetailModalProps {
  // The card that was clicked. Rendered immediately, so the modal has real content before the
  // brand fetch resolves — /api/products already returns every field this view shows.
  product: GalleryProduct;
  onClose: () => void;
  onFollowUp: (target: FollowUpTarget) => void;
}

// A product detail and its brand in one view. The grid can't show packaging or a full
// description without becoming unreadable, and nothing in the UI previously surfaced that
// several products can share one brand voice (D29's follow-up) — both live here.
//
// Native <dialog> rather than a hand-rolled overlay: showModal() gives focus trapping, Escape
// handling, inert background and scroll lock without re-implementing any of them.
export function ProductDetailModal({ product, onClose, onFollowUp }: ProductDetailModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<BrandDetail | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [activeId, setActiveId] = useState(product.id);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/brands/${product.brand.id}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: BrandDetail) => {
        if (!cancelled) setDetail(body);
      })
      .catch(() => {
        if (!cancelled) setDetailFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [product.brand.id]);

  // Siblings arrive with the brand, so switching between them is local — no second request.
  // Before the fetch resolves (or if it fails) the clicked product is still fully rendered.
  const active = detail?.products.find((p) => p.id === activeId) ?? product;
  const siblings = detail?.products.filter((p) => p.id !== activeId) ?? [];
  const toneNotes = detail?.tone_notes;
  const feasibility = active.feasibility_snapshot;
  // The snapshot stores the inputs, not the derived figure (TRD §3 — it's a pure function of
  // them). Reusing the domain helper rather than multiplying inline keeps this identical to
  // the Generate tab's card, rounding included.
  const cash = firstRunCash({ moq: feasibility.moq, costLow: feasibility.cost_low, costHigh: feasibility.cost_high });

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      // A click landing on the dialog itself is a click on the backdrop: the content below is
      // in a child element, so anything inside it never matches.
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
      aria-labelledby="product-detail-title"
      className="m-auto w-[min(46rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink backdrop:bg-black/50"
    >
      <div className="flex max-h-[85vh] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h2 id="product-detail-title" className="text-2xl font-semibold tracking-tight">
              {product.brand.name}
            </h2>
            <p className="mt-1 text-lg text-muted">{active.tagline}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge variant="neutral">{active.source}</Badge>
              <span>{active.category}</span>
              <span>·</span>
              <time dateTime={active.created_at}>{new Date(active.created_at).toLocaleDateString()}</time>
            </div>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-lg px-2 py-1 text-xl leading-none text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            &times;
          </button>
        </header>

        <div className="flex flex-col gap-5 overflow-y-auto px-6 py-5 text-sm">
          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted">The idea it came from</h3>
            <p className="mt-1.5 italic leading-relaxed text-muted">&ldquo;{active.idea}&rdquo;</p>
          </section>

          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Description</h3>
            <p className="mt-1.5 leading-relaxed">{active.description}</p>
          </section>

          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Packaging</h3>
            <div className="mt-1.5 rounded-lg border border-line bg-bg p-4">
              <p className="font-medium">{active.packaging.headline}</p>
              <p className="mt-1.5 leading-relaxed text-muted">{active.packaging.body}</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {active.packaging.callouts.map((callout, i) => (
                  <li key={i}>
                    <Badge variant="accent">{callout}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Feasibility — {feasibility.material}</h3>
              <Badge variant="neutral">Illustrative estimate, not a quote</Badge>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[13px] tabular-nums sm:grid-cols-4">
              <div>
                <dt className="font-sans text-xs text-muted">Unit cost</dt>
                <dd>
                  {feasibility.currency} {feasibility.cost_low}–{feasibility.cost_high}
                </dd>
              </div>
              <div>
                <dt className="font-sans text-xs text-muted">MOQ</dt>
                <dd>{feasibility.moq} units</dd>
              </div>
              <div>
                <dt className="font-sans text-xs text-muted">Lead time</dt>
                <dd>
                  {feasibility.lead_time_days_low}–{feasibility.lead_time_days_high} days
                </dd>
              </div>
              <div>
                <dt className="font-sans text-xs text-muted">First-run cash</dt>
                <dd>
                  {feasibility.currency} {cash.low}–{cash.high}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-muted">{feasibility.assumptions}</p>
          </section>

          {/* Brand-level, and the reason this is a brand view and not just a bigger card: the
              voice is shared by every product below, which is what D29's follow-up produces. */}
          {toneNotes && (
            <section className="border-t border-line pt-5">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Brand voice</h3>
              <div className="mt-2 flex flex-col gap-1.5">
                <p>
                  <span className="font-medium">Voice </span>
                  <span className="text-muted">{toneNotes.voice.join(", ")}</span>
                </p>
                <p>
                  <span className="font-medium">Audience </span>
                  <span className="text-muted">{toneNotes.audience}</span>
                </p>
                <p>
                  <span className="font-medium">Personality </span>
                  <span className="text-muted">{toneNotes.personality}</span>
                </p>
                {toneNotes.avoid.length > 0 && (
                  <p>
                    <span className="font-medium">Avoids </span>
                    <span className="text-muted">{toneNotes.avoid.join(", ")}</span>
                  </p>
                )}
              </div>
            </section>
          )}

          {siblings.length > 0 && (
            <section>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
                Other products in this brand ({siblings.length})
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {siblings.map((sibling) => (
                  <li key={sibling.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(sibling.id)}
                      className="w-full rounded-lg border border-line bg-bg px-4 py-3 text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      <span className="font-medium">{sibling.tagline}</span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {sibling.category} · {sibling.feasibility_snapshot.material}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {detailFailed && <p className="text-muted">The rest of this brand couldn&apos;t be loaded.</p>}
        </div>

        <footer className="border-t border-line px-6 py-4">
          <button
            type="button"
            onClick={() => {
              onFollowUp({ brandId: product.brand.id, brandName: product.brand.name });
              dialogRef.current?.close();
            }}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
          >
            Add another product to this brand
          </button>
        </footer>
      </div>
    </dialog>
  );
}
