import type { LayoutProps } from "rwsdk/router";
import { AuthenticatedLayoutClient } from "./AuthenticatedLayoutClient";

const EMPLOYEE_ROLES = [
  "super_admin",
  "admin",
  "auctioneer",
  "catalog_manager",
  "customer_service",
  "shipping",
];

export function AuthenticatedLayout({ children, requestInfo }: LayoutProps) {
  const ctx = requestInfo?.ctx;
  const role = ctx?.currentOrganization?.role;
  const hasAdminAccess = !!role && EMPLOYEE_ROLES.includes(role);

  return (
    <AuthenticatedLayoutClient
      user={ctx?.user ?? null}
      currentOrganization={ctx?.currentOrganization ?? null}
      hasAdminAccess={hasAdminAccess}
      isPlatformAdmin={ctx?.user?.isPlatformAdmin === 1}
    >
      {children}
    </AuthenticatedLayoutClient>
  );
}
