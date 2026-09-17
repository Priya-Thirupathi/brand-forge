import type { GalleryProduct } from "@/lib/contracts/gallery";
import { Badge } from "@/components/ui/Badge";

export function Gallery({ products }: { products: GalleryProduct[] }) {
  if (products.length === 0) {
    return <p className="text-sm text-muted">No products yet.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product) => (
        <div key={product.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-sm">
          <div className="flex items-center justify-between gap-2">
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
        </div>
      ))}
    </div>
  );
}
