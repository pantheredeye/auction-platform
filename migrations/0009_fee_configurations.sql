CREATE TABLE fee_configurations (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  feeType TEXT NOT NULL,
  calculationType TEXT NOT NULL,
  value INTEGER,
  tieredRules TEXT,
  appliesToRole TEXT,
  appliesToAuctionType TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  effectiveDate TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_fee_config_org ON fee_configurations(organizationId, isActive);
