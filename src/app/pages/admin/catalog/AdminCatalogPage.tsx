import type { RequestInfo } from "rwsdk/worker";
import { listProducts } from "./server-functions/catalog";
import { listCategories } from "./server-functions/categories";
import { AdminCatalogClient } from "./AdminCatalogClient";

export async function AdminCatalogPage({ ctx }: RequestInfo) {
  const [productsResult, categories] = await Promise.all([
    listProducts({}),
    listCategories(),
  ]);

  return (
    <AdminCatalogClient
      initialProducts={productsResult.items}
      initialCursor={productsResult.nextCursor}
      initialHasMore={productsResult.hasMore}
      categories={categories}
    />
  );
}
