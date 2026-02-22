import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { AppDatabase } from "@/db";
import { uploadImage } from "@/lib/r2";
import { slugify } from "@/lib/slug";

interface ShopifyImportMessage {
  type: "shopify-import";
  jobId: string;
  organizationId: string;
  shopUrl: string;
  accessToken: string;
  collectionId?: string;
}

interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string | null;
  product_type: string;
  tags: string;
  images: { src: string }[];
  variants: {
    id: number;
    price: string;
    sku: string | null;
  }[];
}

export async function processShopifyImport(
  message: ShopifyImportMessage,
  env: Cloudflare.Env,
) {
  const db = new Kysely<AppDatabase>({
    dialect: new D1Dialect({ database: env.DB }),
  });

  const { jobId, organizationId, shopUrl, accessToken, collectionId } = message;

  try {
    // Update status to processing
    await db
      .updateTable("import_jobs")
      .set({ status: "processing", updatedAt: new Date().toISOString() })
      .where("id", "=", jobId)
      .execute();

    let allProducts: ShopifyProduct[] = [];
    let pageUrl: string | null = buildShopifyUrl(shopUrl, collectionId);

    // Paginate through Shopify products
    while (pageUrl) {
      const response = await fetch(pageUrl, {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Shopify API error: ${response.status}`);
      }

      const data = (await response.json()) as { products: ShopifyProduct[] };
      allProducts = allProducts.concat(data.products);

      // Update total
      await db
        .updateTable("import_jobs")
        .set({
          totalItems: allProducts.length,
          updatedAt: new Date().toISOString(),
        })
        .where("id", "=", jobId)
        .execute();

      // Check Link header for next page
      pageUrl = getNextPageUrl(response.headers.get("Link"));
    }

    // Process each product
    let processed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const sp of allProducts) {
      try {
        await importSingleProduct(db, env, organizationId, sp);
        processed++;
      } catch (e: any) {
        failed++;
        errors.push(`${sp.title}: ${e.message}`);
      }

      await db
        .updateTable("import_jobs")
        .set({
          processedItems: processed,
          failedItems: failed,
          errorLog: errors.length ? JSON.stringify(errors) : null,
          updatedAt: new Date().toISOString(),
        })
        .where("id", "=", jobId)
        .execute();
    }

    await db
      .updateTable("import_jobs")
      .set({
        status: "completed",
        config: null, // Clear config after processing
        updatedAt: new Date().toISOString(),
      })
      .where("id", "=", jobId)
      .execute();
  } catch (e: any) {
    await db
      .updateTable("import_jobs")
      .set({
        status: "failed",
        errorLog: JSON.stringify([e.message]),
        config: null,
        updatedAt: new Date().toISOString(),
      })
      .where("id", "=", jobId)
      .execute();
  }
}

async function importSingleProduct(
  db: Kysely<AppDatabase>,
  env: Cloudflare.Env,
  organizationId: string,
  sp: ShopifyProduct,
) {
  const shopifyProductId = sp.id.toString();
  const variant = sp.variants[0];
  const now = new Date().toISOString();

  // Check if already imported
  const existing = await db
    .selectFrom("products")
    .select("id")
    .where("organizationId", "=", organizationId)
    .where("shopifyProductId", "=", shopifyProductId)
    .executeTakeFirst();

  // Download images to R2
  const imageKeys: string[] = [];
  for (const img of sp.images.slice(0, 5)) {
    try {
      const resp = await fetch(img.src);
      if (resp.ok) {
        const buffer = await resp.arrayBuffer();
        const ext = img.src.split("?")[0].split(".").pop() || "jpg";
        const key = `products/${organizationId}/${crypto.randomUUID()}.${ext}`;
        await uploadImage(buffer, key);
        imageKeys.push(key);
      }
    } catch {
      // Skip failed image downloads
    }
  }

  // Find or create category from product_type
  let categoryId: string | null = null;
  if (sp.product_type) {
    const cat = await db
      .selectFrom("categories")
      .select("id")
      .where("organizationId", "=", organizationId)
      .where("slug", "=", slugify(sp.product_type))
      .where("deletedAt", "is", null)
      .executeTakeFirst();

    if (cat) {
      categoryId = cat.id;
    } else {
      categoryId = crypto.randomUUID();
      await db
        .insertInto("categories")
        .values({
          id: categoryId,
          organizationId,
          name: sp.product_type,
          slug: slugify(sp.product_type),
          parentId: null,
          sortOrder: 0,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        .execute();
    }
  }

  const priceCents = variant?.price
    ? Math.round(parseFloat(variant.price) * 100)
    : null;

  // Strip HTML from description
  const description = sp.body_html
    ? sp.body_html.replace(/<[^>]*>/g, "").trim()
    : null;

  const productData = {
    title: sp.title,
    description,
    categoryId,
    sku: variant?.sku || null,
    conditionType: null,
    retailPriceCents: priceCents,
    imageUrls: imageKeys.length ? JSON.stringify(imageKeys) : null,
    thumbnailUrl: imageKeys[0] || null,
    shopifyProductId,
    shopifyVariantId: variant?.id?.toString() || null,
    tags: sp.tags || null,
    updatedAt: now,
  };

  if (existing) {
    await db
      .updateTable("products")
      .set(productData)
      .where("id", "=", existing.id)
      .execute();
  } else {
    await db
      .insertInto("products")
      .values({
        id: crypto.randomUUID(),
        organizationId,
        ...productData,
        quantity: 1,
        quantityAvailable: 1,
        isPerishable: 0,
        expiryDate: null,
        coldChainRequired: 0,
        storageTemp: null,
        handlingInstructions: null,
        metadata: null,
        createdAt: now,
        deletedAt: null,
        version: 1,
      })
      .execute();
  }
}

function buildShopifyUrl(shopUrl: string, collectionId?: string): string {
  const base = shopUrl.replace(/\/$/, "");
  let url = `${base}/admin/api/2024-01/products.json?limit=250`;
  if (collectionId) {
    url += `&collection_id=${collectionId}`;
  }
  return url;
}

function getNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1] ?? null;
}
