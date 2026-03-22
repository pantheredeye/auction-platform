import type { RequestInfo } from "rwsdk/worker";
import { getCustomerDetail } from "./server-functions/customers";
import { AdminCustomerDetailClient } from "./AdminCustomerDetailClient";

export async function AdminCustomerDetailPage({ params }: RequestInfo) {
  const userId = params.id as string;
  const detail = await getCustomerDetail(userId);

  if (!detail) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Customer not found.
      </div>
    );
  }

  return <AdminCustomerDetailClient detail={detail} />;
}
