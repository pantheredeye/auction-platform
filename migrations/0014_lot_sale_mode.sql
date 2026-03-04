-- Multi-mode auction support: live_sell, dutch, english (default)
ALTER TABLE lots ADD COLUMN saleMode TEXT NOT NULL DEFAULT 'english';
ALTER TABLE lots ADD COLUMN quantityClaimed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lots ADD COLUMN maxClaimsPerUser INTEGER;
