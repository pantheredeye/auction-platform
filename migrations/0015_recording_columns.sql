-- Add recording columns to auctions table
ALTER TABLE auctions ADD COLUMN recording_key TEXT;
ALTER TABLE auctions ADD COLUMN recording_status TEXT NOT NULL DEFAULT 'none';
