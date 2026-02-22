"use client";

import { Home, Gavel, Clock, FileText, User, LogOut, Shield } from "lucide-react";
import { MobileNav } from "./MobileNav";

const sidebarItems = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/auctions", label: "Auctions", icon: Gavel },
  { href: "/my/bids", label: "My Bids", icon: Clock },
  { href: "/my/invoices", label: "Invoices", icon: FileText },
  { href: "/my/profile", label: "Profile", icon: User },
];

export function AuthenticatedLayoutClient({
  children,
  user,
  currentOrganization,
  hasAdminAccess = false,
  isPlatformAdmin = false,
}: {
  children: React.ReactNode;
  user: any;
  currentOrganization: any;
  hasAdminAccess?: boolean;
  isPlatformAdmin?: boolean;
}) {
  const currentPath =
    typeof window !== "undefined" ? window.location.pathname : "";

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:border-r bg-background">
        <div className="p-4 border-b">
          <a href="/dashboard" className="text-lg font-bold">
            M&amp;M Auctions
          </a>
          {currentOrganization && (
            <p className="text-xs text-muted-foreground mt-1">
              {currentOrganization.name}
            </p>
          )}
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPath === item.href;
            return (
              <a
                key={item.href}
                href={item.href}
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
        <div className="p-4 border-t space-y-2">
          {hasAdminAccess && (
            <a
              href="/admin"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <Gavel size={16} />
              Admin Panel
            </a>
          )}
          {isPlatformAdmin && (
            <a
              href="/platform"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <Shield size={16} />
              Platform
            </a>
          )}
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
              {user?.username?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.username}</p>
              <p className="text-xs text-muted-foreground truncate">
                {currentOrganization?.role}
              </p>
            </div>
          </div>
          <a
            href="/auth/logout"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <LogOut size={16} />
            Sign out
          </a>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-40 border-b bg-background p-3 flex items-center justify-between md:hidden">
        <a href="/dashboard" className="font-bold">
          M&amp;M Auctions
        </a>
        <div className="flex items-center gap-3">
          {hasAdminAccess && (
            <a
              href="/admin"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              <Gavel size={16} />
            </a>
          )}
          {isPlatformAdmin && (
            <a
              href="/platform"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              <Shield size={16} />
            </a>
          )}
          {user && (
            <span className="text-sm text-muted-foreground">
              {user.username}
            </span>
          )}
          <a
            href="/auth/logout"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            <LogOut size={16} />
          </a>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 pb-20 md:pb-4">
        <div className="p-4 md:p-6">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <MobileNav />
    </div>
  );
}
