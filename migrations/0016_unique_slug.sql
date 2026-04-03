-- Replace composite (organizationId, slug) unique index with slug-only unique index
DROP INDEX IF EXISTS idx_auctions_slug;
CREATE UNIQUE INDEX idx_auctions_slug ON auctions(slug);
