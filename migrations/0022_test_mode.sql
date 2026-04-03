-- Test mode: allows orgs to go live without Stripe Connect
ALTER TABLE organizations ADD COLUMN testMode INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auctions ADD COLUMN isTestMode INTEGER NOT NULL DEFAULT 0;
