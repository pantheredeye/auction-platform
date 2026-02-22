"use client";

export function PublicLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b p-4">
        <a href="/" className="text-xl font-bold">
          M&amp;M Auctions
        </a>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
