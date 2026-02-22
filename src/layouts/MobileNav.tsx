"use client";

import { Home, Gavel, Clock, FileText, User } from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/auctions", label: "Auctions", icon: Gavel },
  { href: "/my/bids", label: "My Bids", icon: Clock },
  { href: "/my/invoices", label: "Invoices", icon: FileText },
  { href: "/my/profile", label: "Profile", icon: User },
];

export function MobileNav() {
  const currentPath =
    typeof window !== "undefined" ? window.location.pathname : "";

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background md:hidden">
      <div className="flex justify-around items-center h-16 pb-safe">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPath === item.href;
          return (
            <a
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-xs ${
                isActive
                  ? "text-primary font-medium"
                  : "text-muted-foreground"
              }`}
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
