import type { GenerateResult } from "@/lib/contracts/generate";
import { Badge } from "@/components/ui/Badge";

interface ResultCardProps {
  result: GenerateResult;
  // Stage 5, item 3 (D30): picking one of the names that wasn't selected regenerates the copy
  // around it. Omitted where a regenerate can't or shouldn't be offered — notably a replayed
  // recorded run, where the point is that there's no quota left to spend on a real one.
  onRegenerate?: (alternateName: string) => void;
}

// Only meaningful for a succeeded result — brand/product/name_candidates are all optional in
// GenerateResultSchema because a rejected/errored run never reaches naming's persisted output.
export function ResultCard({ result, onRegenerate }: ResultCardProps) {
  if (!result.brand || !result.product) return null;
  const { brand, product, name_candidates: nameCandidates } = result;

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-6 shadow-[0_1px_0_0_var(--color-accent)]">
      <div>
        <h3 className="text-2xl font-semibold tracking-tight">{brand.name}</h3>
        <p className="mt-1 text-lg text-muted">{product.tagline}</p>
      </div>

      {nameCandidates && nameCandidates.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-muted">{onRegenerate ? "Rebuild around" : "Also considered"}</span>
          {nameCandidates
            .filter((c) => !c.selected)
            .map((c) =>
              onRegenerate ? (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => onRegenerate(c.name)}
                  title={`Rewrite the tagline, description and packaging around "${c.name}"`}
                  className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <Badge variant="accent">{c.name}</Badge>
                </button>
              ) : (
                <Badge key={c.name} variant="neutral">
                  {c.name}
                </Badge>
              ),
            )}
        </div>
      )}

      <p className="text-sm leading-relaxed">{product.description}</p>

      <div className="rounded-lg border border-line bg-bg p-4 text-sm">
        <p className="font-medium">{product.packaging.headline}</p>
        <p className="mt-1.5 leading-relaxed text-muted">{product.packaging.body}</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {product.packaging.callouts.map((callout, i) => (
            <li key={i}>
              <Badge variant="accent">{callout}</Badge>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-1 text-sm text-muted sm:flex-row sm:gap-6">
        <span>
          <span className="font-medium text-ink">Voice </span>
          {brand.tone_notes.voice.join(", ")}
        </span>
        <span>
          <span className="font-medium text-ink">Audience </span>
          {brand.tone_notes.audience}
        </span>
      </div>
    </div>
  );
}
