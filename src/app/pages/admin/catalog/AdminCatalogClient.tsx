"use client";

import { useState, useTransition } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Badge } from "@/app/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { Plus, Search, Trash2 } from "lucide-react";
import { listProducts, deleteProduct } from "./server-functions/catalog";
import { formatCents } from "@/lib/money";
import { imageUrl } from "@/lib/image-url";

interface Product {
  id: string;
  title: string;
  sku: string | null;
  categoryId: string | null;
  conditionType: string | null;
  retailPriceCents: number | null;
  quantity: number;
  quantityAvailable: number;
  isPerishable: number;
  thumbnailUrl: string | null;
  createdAt: string;
}

interface Category {
  id: string;
  name: string;
}

const CONDITION_TYPES = [
  { value: "new", label: "New" },
  { value: "like_new", label: "Like New" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "salvage", label: "Salvage" },
];

export function AdminCatalogClient({
  initialProducts,
  initialCursor,
  initialHasMore,
  categories,
}: {
  initialProducts: Product[];
  initialCursor: string | null;
  initialHasMore: boolean;
  categories: Category[];
}) {
  const [products, setProducts] = useState(initialProducts);
  const [cursor, setCursor] = useState(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [conditionFilter, setConditionFilter] = useState<string>("");
  const [perishableFilter, setPerishableFilter] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  function doSearch() {
    startTransition(async () => {
      const result = await listProducts({
        search: search || undefined,
        categoryId: categoryFilter || undefined,
        conditionType: conditionFilter || undefined,
        isPerishable:
          perishableFilter === "yes"
            ? true
            : perishableFilter === "no"
              ? false
              : undefined,
      });
      setProducts(result.items);
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
    });
  }

  function loadMore() {
    if (!cursor) return;
    startTransition(async () => {
      const result = await listProducts({
        cursor,
        search: search || undefined,
        categoryId: categoryFilter || undefined,
        conditionType: conditionFilter || undefined,
      });
      setProducts((prev) => [...prev, ...result.items]);
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteProduct(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
      setDeleteConfirm(null);
    });
  }

  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Catalog</h1>
        <a href="/admin/catalog/products/new">
          <Button size="sm">
            <Plus size={16} /> Add Product
          </Button>
        </a>
      </div>

      <Tabs defaultValue="products" className="mb-4">
        <TabsList>
          <TabsTrigger value="products" asChild>
            <a href="/admin/catalog">Products</a>
          </TabsTrigger>
          <TabsTrigger value="categories" asChild>
            <a href="/admin/catalog/categories">Categories</a>
          </TabsTrigger>
          <TabsTrigger value="import" asChild>
            <a href="/admin/catalog/import">Import</a>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={16}
            className="absolute left-2.5 top-2.5 text-muted-foreground"
          />
          <Input
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            className="pl-8"
          />
        </div>
        <Select
          value={categoryFilter}
          onValueChange={(v) => {
            setCategoryFilter(v === "all" ? "" : v);
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={conditionFilter}
          onValueChange={(v) => {
            setConditionFilter(v === "all" ? "" : v);
          }}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Condition" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Conditions</SelectItem>
            {CONDITION_TYPES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={perishableFilter}
          onValueChange={(v) => {
            setPerishableFilter(v === "all" ? "" : v);
          }}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Perishable" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="yes">Perishable</SelectItem>
            <SelectItem value="no">Non-perishable</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={doSearch} variant="secondary" disabled={isPending}>
          Search
        </Button>
      </div>

      {/* Products table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[50px]"></TableHead>
            <TableHead>Title</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Condition</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Qty</TableHead>
            <TableHead className="w-[80px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                No products found.
              </TableCell>
            </TableRow>
          ) : (
            products.map((product) => (
              <TableRow key={product.id}>
                <TableCell>
                  {product.thumbnailUrl ? (
                    <img
                      src={imageUrl(product.thumbnailUrl)}
                      alt=""
                      className="w-10 h-10 object-cover rounded"
                    />
                  ) : (
                    <div className="w-10 h-10 bg-muted rounded" />
                  )}
                </TableCell>
                <TableCell>
                  <a
                    href={`/admin/catalog/products/${product.id}`}
                    className="font-medium hover:underline"
                  >
                    {product.title}
                  </a>
                  {product.isPerishable === 1 && (
                    <Badge variant="outline" className="ml-2 text-xs">
                      Perishable
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {product.sku || "—"}
                </TableCell>
                <TableCell>
                  {product.categoryId
                    ? categoryMap.get(product.categoryId) || "—"
                    : "—"}
                </TableCell>
                <TableCell>
                  {product.conditionType ? (
                    <Badge variant="secondary">{product.conditionType}</Badge>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {product.retailPriceCents
                    ? formatCents(product.retailPriceCents)
                    : "—"}
                </TableCell>
                <TableCell>{product.quantityAvailable}</TableCell>
                <TableCell>
                  {deleteConfirm === product.id ? (
                    <div className="flex gap-1">
                      <Button
                        variant="destructive"
                        size="xs"
                        onClick={() => handleDelete(product.id)}
                        disabled={isPending}
                      >
                        Yes
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setDeleteConfirm(null)}
                      >
                        No
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setDeleteConfirm(product.id)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {hasMore && (
        <div className="mt-4 text-center">
          <Button
            variant="outline"
            onClick={loadMore}
            disabled={isPending}
          >
            {isPending ? "Loading..." : "Load More"}
          </Button>
        </div>
      )}
    </div>
  );
}
