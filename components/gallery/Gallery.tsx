import type { GalleryProduct } from "@/lib/contracts/gallery";

export function Gallery({ products }: { products: GalleryProduct[] }) {
  if (products.length === 0) {
    return <p className="text-sm text-zinc-500">No products yet.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product) => (
        <div key={product.id} className="flex flex-col gap-2 rounded border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{product.brand.name}</h3>
            <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs dark:bg-zinc-800">{product.source}</span>
          </div>
          <p className="text-zinc-500">{product.category}</p>
          <p className="font-medium">{product.tagline}</p>
          <p className="line-clamp-3 text-zinc-700 dark:text-zinc-300">{product.description}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {product.feasibility_snapshot.material} · {product.feasibility_snapshot.currency}{" "}
            {product.feasibility_snapshot.cost_low}–{product.feasibility_snapshot.cost_high}
          </p>
        </div>
      ))}
    </div>
  );
}
