import type { GenerateResult } from "@/lib/contracts/generate";

// Only meaningful for a succeeded result — brand/product/name_candidates are all optional in
// GenerateResultSchema because a rejected/errored run never reaches naming's persisted output.
export function ResultCard({ result }: { result: GenerateResult }) {
  if (!result.brand || !result.product) return null;
  const { brand, product, name_candidates: nameCandidates } = result;

  return (
    <div className="flex flex-col gap-4 rounded border border-zinc-200 p-5 dark:border-zinc-800">
      <div>
        <h3 className="text-2xl font-semibold">{brand.name}</h3>
        <p className="mt-1 text-lg text-zinc-700 dark:text-zinc-300">{product.tagline}</p>
      </div>

      {nameCandidates && nameCandidates.length > 1 && (
        <div className="text-sm">
          <span className="font-medium">Alternate names: </span>
          {nameCandidates
            .filter((c) => !c.selected)
            .map((c) => c.name)
            .join(", ")}
        </div>
      )}

      <p className="text-sm text-zinc-700 dark:text-zinc-300">{product.description}</p>

      <div className="rounded bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
        <p className="font-medium">{product.packaging.headline}</p>
        <p className="mt-1 text-zinc-700 dark:text-zinc-300">{product.packaging.body}</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {product.packaging.callouts.map((callout, i) => (
            <li key={i} className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs dark:bg-zinc-800">
              {callout}
            </li>
          ))}
        </ul>
      </div>

      <div className="text-sm">
        <span className="font-medium">Voice: </span>
        {brand.tone_notes.voice.join(", ")}
        <span className="ml-4 font-medium">Audience: </span>
        {brand.tone_notes.audience}
      </div>
    </div>
  );
}
