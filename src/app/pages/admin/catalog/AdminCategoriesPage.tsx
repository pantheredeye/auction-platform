import type { RequestInfo } from "rwsdk/worker";
import { listCategories } from "./server-functions/categories";
import { AdminCategoriesClient } from "./AdminCategoriesClient";

export async function AdminCategoriesPage({ ctx }: RequestInfo) {
  const categories = await listCategories();

  return <AdminCategoriesClient categories={categories} />;
}
