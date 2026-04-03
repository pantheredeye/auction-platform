import type { RequestInfo } from "rwsdk/worker";
import { getOrgSettings } from "./server-functions/settings";
import { AdminSettingsClient } from "./AdminSettingsClient";

export async function AdminSettingsPage(_: RequestInfo) {
  const settings = await getOrgSettings();

  return <AdminSettingsClient initialSettings={settings} />;
}
