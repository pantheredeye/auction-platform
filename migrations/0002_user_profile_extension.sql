-- User profile extension + password auth + roles
ALTER TABLE users ADD COLUMN displayName TEXT;
ALTER TABLE users ADD COLUMN avatarUrl TEXT;
ALTER TABLE users ADD COLUMN addressLine1 TEXT;
ALTER TABLE users ADD COLUMN addressLine2 TEXT;
ALTER TABLE users ADD COLUMN city TEXT;
ALTER TABLE users ADD COLUMN state TEXT;
ALTER TABLE users ADD COLUMN zip TEXT;
ALTER TABLE users ADD COLUMN passwordHash TEXT;
ALTER TABLE users ADD COLUMN authMethod TEXT NOT NULL DEFAULT 'passkey';
ALTER TABLE users ADD COLUMN failedLoginAttempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN lockoutUntil TEXT;
ALTER TABLE users ADD COLUMN isPlatformAdmin INTEGER NOT NULL DEFAULT 0;

-- Hammer fee on organizations
ALTER TABLE organizations ADD COLUMN hammerFeePct INTEGER NOT NULL DEFAULT 300;

-- Role-based membership fields
ALTER TABLE memberships ADD COLUMN isApproved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memberships ADD COLUMN approvedAt TEXT;
ALTER TABLE memberships ADD COLUMN approvedByUserId TEXT;
