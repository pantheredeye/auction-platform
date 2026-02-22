const EMPLOYEE_ROLES = [
  "super_admin",
  "admin",
  "auctioneer",
  "catalog_manager",
  "customer_service",
  "shipping",
];

export function getPostLoginRedirect(
  isPlatformAdmin: number | null | undefined,
  role: string | null | undefined,
): string {
  if (isPlatformAdmin === 1) return "/platform";
  if (role && EMPLOYEE_ROLES.includes(role)) return "/admin";
  return "/dashboard";
}
