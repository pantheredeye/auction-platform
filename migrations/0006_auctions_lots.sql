CREATE TABLE auctions (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduledStartAt TEXT,
  actualStartAt TEXT,
  actualEndAt TEXT,
  defaultIncrementCents INTEGER NOT NULL DEFAULT 100,
  incrementRules TEXT,
  buyerPremiumPct INTEGER NOT NULL DEFAULT 0,
  extensionSeconds INTEGER NOT NULL DEFAULT 15,
  streamProviderId TEXT,
  streamUrl TEXT,
  auctioneerId TEXT REFERENCES users(id),
  createdByUserId TEXT NOT NULL REFERENCES users(id),
  clonedFromAuctionId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_auctions_org_status ON auctions(organizationId, status);
CREATE UNIQUE INDEX idx_auctions_slug ON auctions(organizationId, slug);

CREATE TABLE auction_state_transitions (
  id TEXT PRIMARY KEY,
  auctionId TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  fromStatus TEXT,
  toStatus TEXT NOT NULL,
  triggeredByUserId TEXT,
  reason TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX idx_ast_auction ON auction_state_transitions(auctionId);

CREATE TABLE lots (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  auctionId TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  lotNumber INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  startingPriceCents INTEGER NOT NULL DEFAULT 100,
  reservePriceCents INTEGER,
  buyNowPriceCents INTEGER,
  incrementCents INTEGER,
  currentBidCents INTEGER,
  currentBidderId TEXT,
  bidCount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  quantity INTEGER NOT NULL DEFAULT 1,
  extensionSeconds INTEGER,
  closesAt TEXT,
  winnerUserId TEXT,
  winnerAmountCents INTEGER,
  imageUrls TEXT,
  thumbnailUrl TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_lots_auction ON lots(auctionId, lotNumber);

CREATE TABLE lot_items (
  id TEXT PRIMARY KEY,
  lotId TEXT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  productId TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  sortOrder INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_lot_items_lot ON lot_items(lotId);
