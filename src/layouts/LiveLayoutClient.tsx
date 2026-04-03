"use client";

import { Toaster } from "@/app/components/ui/sonner";

export function LiveLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col bg-zinc-950 text-white">
      {children}
      <Toaster position="top-center" />
    </div>
  );
}
