CREATE TABLE dealer_profiles (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  companyName TEXT,
  taxId TEXT,
  resaleCertificateUrl TEXT,
  tier TEXT NOT NULL DEFAULT 'standard',
  creditTerms TEXT,
  depositRequiredCents INTEGER,
  totalPurchasesCents INTEGER NOT NULL DEFAULT 0,
  totalAuctionsParticipated INTEGER NOT NULL DEFAULT 0,
  standing TEXT NOT NULL DEFAULT 'good',
  notes TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_dealer_profiles_org ON dealer_profiles(organizationId);
CREATE UNIQUE INDEX idx_dealer_profiles_user ON dealer_profiles(userId);
