CREATE TABLE pickup_slots (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  startTime TEXT NOT NULL,
  endTime TEXT NOT NULL,
  maxCapacity INTEGER NOT NULL,
  currentBookings INTEGER NOT NULL DEFAULT 0,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_pickup_slots_org_date ON pickup_slots(organizationId, date);

CREATE TABLE pickup_reservations (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pickupSlotId TEXT NOT NULL REFERENCES pickup_slots(id),
  invoiceId TEXT NOT NULL REFERENCES invoices(id),
  userId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  idempotencyKey TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_pickup_res_slot ON pickup_reservations(pickupSlotId);
CREATE INDEX idx_pickup_res_user ON pickup_reservations(userId);
