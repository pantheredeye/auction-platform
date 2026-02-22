-- Users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  name TEXT,
  phone TEXT,
  createdAt TEXT NOT NULL,
  deletedAt TEXT
);

-- Credentials table (passkeys)
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credentialId TEXT NOT NULL UNIQUE,
  publicKey TEXT NOT NULL,
  counter INTEGER NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX credentials_userId_idx ON credentials(userId);

-- Organizations table
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- Memberships table
CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX memberships_userId_idx ON memberships(userId);
CREATE INDEX memberships_organizationId_idx ON memberships(organizationId);
