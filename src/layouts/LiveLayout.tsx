import type { LayoutProps } from "rwsdk/router";
import { LiveLayoutClient } from "./LiveLayoutClient";

export function LiveLayout({ children }: LayoutProps) {
  return <LiveLayoutClient>{children}</LiveLayoutClient>;
}
