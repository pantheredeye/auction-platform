"use client";

import { useState } from "react";
import {
  Gavel,
  Package,
  CalendarDays,
  ShoppingCart,
  FileText,
  Truck,
  Users,
  Settings,
  LogOut,
  ArrowLeft,
  Menu,
  Shield,
  type LucideIcon,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/app/components/ui/sheet";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const defaultAdminNavItems: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: Gavel },
  { href: "/admin/auctions", label: "Auctions", icon: CalendarDays },
  { href: "/admin/catalog", label: "Catalog", icon: Package },
  { href: "/admin/orders", label: "Orders", icon: ShoppingCart },
  { href: "/admin/invoices", label: "Invoices", icon: FileText },
  { href: "/admin/pickups", label: "Pickups", icon: Truck },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

interface SwitchLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

export function AdminLayoutClient({
  children,
  user,
  currentOrganization,
  navItems = defaultAdminNavItems,
  title = "Admin Panel",
  backLink = { href: "/dashboard", label: "Shopper View" },
  hasAdminAccess = false,
  isPlatformAdmin = false,
}: {
  children: React.ReactNode;
  user: any;
  currentOrganization: any;
  navItems?: NavItem[];
  title?: string;
  backLink?: { href: string; label: string };
  hasAdminAccess?: boolean;
  isPlatformAdmin?: boolean;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const currentPath =
    typeof window !== "undefined" ? window.location.pathname : "";

  const switchLinks: SwitchLink[] = [];
  if (backLink) {
    switchLinks.push({ ...backLink, icon: ArrowLeft });
  }
  // Show "Admin Panel" link from platform layout
  if (hasAdminAccess && title !== "Admin Panel") {
    switchLinks.push({ href: "/admin", label: "Admin Panel", icon: Gavel });
  }
  // Show "Platform" link from admin layout
  if (isPlatformAdmin && title !== "Platform Admin") {
    switchLinks.push({ href: "/platform", label: "Platform", icon: Shield });
  }

  const navContent = (
    <nav className="flex-1 p-2 space-y-1">
      {navItems.map((item) => {
        const Icon = item.icon;
        const basePath = navItems[0]?.href;
        const isActive =
          item.href === basePath
            ? currentPath === basePath
            : currentPath.startsWith(item.href);
        return (
          <a
            key={item.href}
            href={item.href}
            onClick={() => setSheetOpen(false)}
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm ${
              isActive
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            <Icon size={18} />
            {item.label}
          </a>
        );
      })}
    </nav>
  );

  const footerContent = (
    <div className="p-4 border-t space-y-2">
      {switchLinks.map((link) => {
        const Icon = link.icon;
        return (
          <a
            key={link.href}
            href={link.href}
            onClick={() => setSheetOpen(false)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <Icon size={16} />
            {link.label}
          </a>
        );
      })}
      <a
        href="/auth/logout"
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <LogOut size={16} />
        Sign out
      </a>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:border-r bg-background">
        <div className="p-4 border-b">
          <a href={backLink.href} className="text-lg font-bold">
            M&amp;M Auctions
          </a>
          <p className="text-xs text-muted-foreground mt-1">{title}</p>
        </div>
        {navContent}
        {footerContent}
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-40 border-b bg-background p-3 flex items-center justify-between md:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <button className="p-1">
              <Menu size={20} />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetHeader className="p-4 border-b">
              <SheetTitle className="text-left">{title}</SheetTitle>
            </SheetHeader>
            {navContent}
            {footerContent}
          </SheetContent>
        </Sheet>
        <span className="font-bold">{title}</span>
        <div className="w-7" />
      </header>

      {/* Main content */}
      <main className="flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
