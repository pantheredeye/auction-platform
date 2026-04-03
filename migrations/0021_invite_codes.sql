CREATE TABLE invite_codes (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  createdByUserId TEXT NOT NULL,
  usedByUserId TEXT,
  usedAt TEXT,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX idx_invite_codes_org ON invite_codes(organizationId);
CREATE INDEX idx_invite_codes_code ON invite_codes(code);
