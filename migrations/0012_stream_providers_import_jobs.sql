CREATE TABLE stream_providers (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  providerType TEXT NOT NULL DEFAULT 'cloudflare_stream',
  name TEXT NOT NULL,
  config TEXT,
  isDefault INTEGER NOT NULL DEFAULT 1,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  totalItems INTEGER NOT NULL DEFAULT 0,
  processedItems INTEGER NOT NULL DEFAULT 0,
  failedItems INTEGER NOT NULL DEFAULT 0,
  errorLog TEXT,
  config TEXT,
  createdByUserId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
