CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  auctionId TEXT NOT NULL,
  lotId TEXT NOT NULL,
  userId TEXT NOT NULL,
  amountCents INTEGER NOT NULL,
  premiumCents INTEGER NOT NULL,
  platformFeeCents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'won',
  invoiceId TEXT,
  idempotencyKey TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_orders_user ON orders(userId, status);
CREATE INDEX idx_orders_auction ON orders(auctionId);
CREATE INDEX idx_orders_invoice ON orders(invoiceId);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  userId TEXT NOT NULL,
  auctionId TEXT NOT NULL,
  invoiceNumber TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  subtotalCents INTEGER NOT NULL,
  buyerPremiumCents INTEGER NOT NULL,
  taxCents INTEGER NOT NULL DEFAULT 0,
  totalCents INTEGER NOT NULL,
  stripePaymentLinkId TEXT,
  stripePaymentLinkUrl TEXT,
  paidAt TEXT,
  dueAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_invoices_user ON invoices(userId);
CREATE INDEX idx_invoices_org_status ON invoices(organizationId, status);

CREATE TABLE invoice_line_items (
  id TEXT PRIMARY KEY,
  invoiceId TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  orderId TEXT NOT NULL REFERENCES orders(id),
  lotId TEXT NOT NULL,
  description TEXT NOT NULL,
  amountCents INTEGER NOT NULL,
  buyerPremiumCents INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_invoice_items ON invoice_line_items(invoiceId);
