import type { GalleryProduct } from "@/lib/contracts/gallery";
import { Badge } from "@/components/ui/Badge";

interface GalleryProps {
  products: GalleryProduct[];
  onSelect: (product: GalleryProduct) => void;
}

export function Gallery({ products, onSelect }: GalleryProps) {
  if (products.length === 0) {
    return <p className="text-sm text-muted">No products yet.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product) => (
        // The whole card is the control, so the click target matches what looks clickable.
        // A <button> rather than a div with a handler: keyboard and screen-reader support,
        // and a focus ring, all without an explicit tabIndex/keydown dance. "Add another
        // product to this brand" used to live here as a second, competing target — it moved
        // into the modal, where it sits next to the brand it acts on.
        <button
          key={product.id}
          type="button"
          onClick={() => onSelect(product)}
          className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-left text-sm transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <div className="flex w-full items-center justify-between gap-2">
            <h3 className="font-semibold">{product.brand.name}</h3>
            <Badge variant="neutral">{product.source}</Badge>
          </div>
          <p className="text-xs text-muted">{product.category}</p>
          <p className="font-medium">{product.tagline}</p>
          <p className="line-clamp-3 text-muted">{product.description}</p>
          <p className="mt-1 font-mono text-xs tabular-nums text-muted">
            {product.feasibility_snapshot.material} · {product.feasibility_snapshot.currency}{" "}
            {product.feasibility_snapshot.cost_low}–{product.feasibility_snapshot.cost_high}
          </p>
        </button>
      ))}
    </div>
  );
}
