import type { RequestInfo } from "rwsdk/worker";
import { listImportJobs } from "./server-functions/import";
import { AdminImportClient } from "./AdminImportClient";

export async function AdminImportPage({ ctx }: RequestInfo) {
  const jobs = await listImportJobs();

  return <AdminImportClient initialJobs={jobs} />;
}
