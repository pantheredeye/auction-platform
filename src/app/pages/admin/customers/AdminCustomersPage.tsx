import type { RequestInfo } from "rwsdk/worker";
import { listCustomers } from "./server-functions/customers";
import { AdminCustomersClient } from "./AdminCustomersClient";

export async function AdminCustomersPage(_: RequestInfo) {
  const result = await listCustomers({});

  return (
    <AdminCustomersClient
      initialCustomers={result.items}
      initialCursor={result.nextCursor}
      initialHasMore={result.hasMore}
    />
  );
}
