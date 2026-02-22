CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  parentId TEXT REFERENCES categories(id),
  sortOrder INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE INDEX idx_categories_org ON categories(organizationId);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  categoryId TEXT REFERENCES categories(id),
  sku TEXT,
  title TEXT NOT NULL,
  description TEXT,
  conditionType TEXT,
  retailPriceCents INTEGER,
  quantity INTEGER NOT NULL DEFAULT 1,
  quantityAvailable INTEGER NOT NULL DEFAULT 1,
  isPerishable INTEGER NOT NULL DEFAULT 0,
  expiryDate TEXT,
  coldChainRequired INTEGER NOT NULL DEFAULT 0,
  storageTemp TEXT,
  handlingInstructions TEXT,
  imageUrls TEXT,
  thumbnailUrl TEXT,
  shopifyProductId TEXT,
  shopifyVariantId TEXT,
  tags TEXT,
  metadata TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_products_org ON products(organizationId);
CREATE INDEX idx_products_shopify ON products(shopifyProductId);
CREATE INDEX idx_products_perishable ON products(organizationId, isPerishable, expiryDate);
