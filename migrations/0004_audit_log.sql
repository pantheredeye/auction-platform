CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  userId TEXT,
  entityType TEXT NOT NULL,
  entityId TEXT NOT NULL,
  action TEXT NOT NULL,
  changes TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX idx_audit_logs_org ON audit_logs(organizationId);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entityType, entityId);
