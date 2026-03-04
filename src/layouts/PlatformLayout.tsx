import type { LayoutProps } from "rwsdk/router";
import { AdminLayoutClient } from "./AdminLayoutClient";

const EMPLOYEE_ROLES = [
  "super_admin",
  "admin",
  "auctioneer",
  "catalog_manager",
  "customer_service",
  "shipping",
];

export function PlatformLayout({ children, requestInfo }: LayoutProps) {
  const ctx = requestInfo?.ctx;
  const role = ctx?.currentOrganization?.role;
  const hasAdminAccess = !!role && EMPLOYEE_ROLES.includes(role);

  return (
    <AdminLayoutClient
      user={ctx?.user ?? null}
      currentOrganization={ctx?.currentOrganization ?? null}
      navPreset="platform"
      title="Platform Admin"
      backLink={{ href: "/dashboard", label: "Shopper View" }}
      hasAdminAccess={hasAdminAccess}
      isPlatformAdmin={true}
    >
      {children}
    </AdminLayoutClient>
  );
}
