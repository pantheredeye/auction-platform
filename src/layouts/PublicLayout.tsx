import type { LayoutProps } from "rwsdk/router";
import { PublicLayoutClient } from "./PublicLayoutClient";

export function PublicLayout({ children }: LayoutProps) {
  return <PublicLayoutClient>{children}</PublicLayoutClient>;
}
