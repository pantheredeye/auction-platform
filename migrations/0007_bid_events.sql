CREATE TABLE bid_events (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  auctionId TEXT NOT NULL,
  lotId TEXT NOT NULL,
  userId TEXT NOT NULL,
  type TEXT NOT NULL,
  amountCents INTEGER NOT NULL,
  previousHighCents INTEGER,
  previousHighUserId TEXT,
  onBehalfOfName TEXT,
  placedByUserId TEXT,
  idempotencyKey TEXT NOT NULL UNIQUE,
  sequence INTEGER NOT NULL,
  metadata TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX idx_bid_events_lot_seq ON bid_events(lotId, sequence);
CREATE INDEX idx_bid_events_auction ON bid_events(auctionId);
CREATE INDEX idx_bid_events_user ON bid_events(userId);
