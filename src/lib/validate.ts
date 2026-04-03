export function assertPositiveInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function assertRange(value: number, min: number, max: number, name: string): void {
  if (typeof value !== "number" || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
}

export function assertEnum<T extends string>(value: string, allowed: readonly T[], name: string): asserts value is T {
  if (!allowed.includes(value as T)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
}

export function assertAdminRole(role: string | undefined | null): void {
  if (!role || !["super_admin", "admin"].includes(role)) {
    throw new Error("Admin access required");
  }
}

export function assertAuctioneerRole(role: string | undefined | null): void {
  if (!role || !["super_admin", "admin", "auctioneer"].includes(role)) {
    throw new Error("Admin or auctioneer access required");
  }
}
