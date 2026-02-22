import type { RequestInfo } from "rwsdk/worker";
import { getProduct } from "./server-functions/catalog";
import { listCategories } from "./server-functions/categories";
import { AdminProductFormClient } from "./AdminProductFormClient";

export async function AdminProductFormPage({ ctx, params }: RequestInfo) {
  const categories = await listCategories();
  const productId = params?.id as string | undefined;

  let product = null;
  if (productId) {
    product = await getProduct(productId);
  }

  return (
    <AdminProductFormClient product={product} categories={categories} />
  );
}
