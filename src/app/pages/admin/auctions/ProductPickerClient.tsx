"use client";

import { useState, useTransition } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Search, Plus, X } from "lucide-react";
import { searchProducts } from "./server-functions/lots";
import { formatCents } from "@/lib/money";
import { imageUrl } from "@/lib/image-url";

interface ProductResult {
  id: string;
  title: string;
  sku: string | null;
  thumbnailUrl: string | null;
  quantityAvailable: number;
  retailPriceCents: number | null;
}

export function ProductPickerClient({
  onSelect,
  onCancel,
}: {
  onSelect: (productId: string, quantity: number) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductResult[]>([]);
  const [isPending, startTransition] = useTransition();
  const [searched, setSearched] = useState(false);

  function doSearch() {
    if (!query.trim()) return;
    startTransition(async () => {
      const products = await searchProducts(query.trim());
      setResults(products);
      setSearched(true);
    });
  }

  return (
    <div className="border rounded-md p-2 space-y-2 bg-muted/30">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-2 top-2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Search products..."
            className="h-8 pl-7 text-xs"
          />
        </div>
        <Button
          variant="secondary"
          size="xs"
          onClick={doSearch}
          disabled={isPending}
        >
          Search
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onCancel}>
          <X size={14} />
        </Button>
      </div>

      {searched && results.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          No products found.
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {results.map((product) => (
            <div
              key={product.id}
              className="flex items-center gap-2 p-1.5 rounded hover:bg-muted text-xs"
            >
              {product.thumbnailUrl ? (
                <img
                  src={imageUrl(product.thumbnailUrl)}
                  alt=""
                  className="w-8 h-8 object-cover rounded"
                />
              ) : (
                <div className="w-8 h-8 bg-muted rounded" />
              )}
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{product.title}</div>
                <div className="text-muted-foreground">
                  {product.sku && <span>{product.sku} · </span>}
                  Qty: {product.quantityAvailable}
                  {product.retailPriceCents && (
                    <span>
                      {" "}
                      · {formatCents(product.retailPriceCents)}
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="icon-xs"
                onClick={() => onSelect(product.id, 1)}
                disabled={isPending}
              >
                <Plus size={12} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
