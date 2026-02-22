import type { RequestInfo } from "rwsdk/worker";
import { DashboardClient } from "./DashboardClient";

export function Dashboard({ ctx }: RequestInfo) {
  return (
    <DashboardClient
      user={ctx.user!}
      currentOrganization={ctx.currentOrganization}
    />
  );
}
