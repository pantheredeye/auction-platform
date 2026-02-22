import type { LayoutProps } from "rwsdk/router";
import { AdminLayoutClient, type NavItem } from "./AdminLayoutClient";
import { LayoutDashboard, Building2, DollarSign } from "lucide-react";

const EMPLOYEE_ROLES = [
  "super_admin",
  "admin",
  "auctioneer",
  "catalog_manager",
  "customer_service",
  "shipping",
];

const platformNavItems: NavItem[] = [
  { href: "/platform", label: "Dashboard", icon: LayoutDashboard },
  { href: "/platform/organizations", label: "Organizations", icon: Building2 },
  { href: "/platform/revenue", label: "Revenue", icon: DollarSign },
];

export function PlatformLayout({ children, requestInfo }: LayoutProps) {
  const ctx = requestInfo?.ctx;
  const role = ctx?.currentOrganization?.role;
  const hasAdminAccess = !!role && EMPLOYEE_ROLES.includes(role);

  return (
    <AdminLayoutClient
      user={ctx?.user ?? null}
      currentOrganization={ctx?.currentOrganization ?? null}
      navItems={platformNavItems}
      title="Platform Admin"
      backLink={{ href: "/dashboard", label: "Shopper View" }}
      hasAdminAccess={hasAdminAccess}
      isPlatformAdmin={true}
    >
      {children}
    </AdminLayoutClient>
  );
}
