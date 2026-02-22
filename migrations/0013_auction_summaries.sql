CREATE TABLE auction_summaries (
  auctionId TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  totalLots INTEGER NOT NULL DEFAULT 0,
  activeLotNumber INTEGER,
  totalBids INTEGER NOT NULL DEFAULT 0,
  totalRevenueCents INTEGER NOT NULL DEFAULT 0,
  viewerCount INTEGER NOT NULL DEFAULT 0,
  scheduledStartAt TEXT,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_auction_summaries_org ON auction_summaries(organizationId, status);
