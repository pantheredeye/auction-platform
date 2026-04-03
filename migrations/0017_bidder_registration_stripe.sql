-- Bidder registration + Stripe columns

-- Organization-level bidder requirements and Stripe Connect
ALTER TABLE organizations ADD COLUMN bidderRequirement TEXT NOT NULL DEFAULT 'guest';
ALTER TABLE organizations ADD COLUMN stripeConnectAccountId TEXT;

-- Per-auction bidder requirement override
ALTER TABLE auctions ADD COLUMN bidderRequirement TEXT;

-- User Stripe customer ID
ALTER TABLE users ADD COLUMN stripeCustomerId TEXT;

-- Payment methods
CREATE TABLE payment_methods (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id),
  stripePaymentMethodId TEXT NOT NULL UNIQUE,
  last4 TEXT NOT NULL,
  brand TEXT NOT NULL,
  expMonth INTEGER NOT NULL,
  expYear INTEGER NOT NULL,
  isDefault INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_payment_methods_userId ON payment_methods(userId);

-- Bidder registrations (guest-to-user mapping)
CREATE TABLE bidder_registrations (
  id TEXT PRIMARY KEY,
  guestId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES users(id),
  createdAt TEXT NOT NULL
);
CREATE INDEX idx_bidder_registrations_guestId ON bidder_registrations(guestId);
CREATE UNIQUE INDEX idx_bidder_registrations_guest_user ON bidder_registrations(guestId, userId);

-- Terms acceptances
CREATE TABLE terms_acceptances (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id),
  termsType TEXT NOT NULL,
  termsVersion TEXT NOT NULL,
  organizationId TEXT,
  acceptedAt TEXT NOT NULL,
  ipAddress TEXT
);
CREATE INDEX idx_terms_acceptances_userId ON terms_acceptances(userId);
