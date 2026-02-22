CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  auctionId TEXT NOT NULL,
  userId TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'message',
  content TEXT NOT NULL,
  isModerated INTEGER NOT NULL DEFAULT 0,
  moderatedByUserId TEXT,
  moderatedAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX idx_chat_auction ON chat_messages(auctionId, createdAt);
