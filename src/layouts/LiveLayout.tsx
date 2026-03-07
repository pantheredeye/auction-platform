import type { LayoutProps } from "rwsdk/router";

export function LiveLayout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">{children}</div>
  );
}
