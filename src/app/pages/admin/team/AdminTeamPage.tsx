import type { RequestInfo } from "rwsdk/worker";
import { listMembers, listInvites } from "./server-functions/team";
import { AdminTeamClient } from "./AdminTeamClient";

export async function AdminTeamPage({ ctx }: RequestInfo) {
  const [membersResult, invites] = await Promise.all([
    listMembers({}),
    listInvites(),
  ]);

  const currentUserId = ctx.user!.id;
  const currentRole = ctx.currentOrganization!.role;

  return (
    <AdminTeamClient
      initialMembers={membersResult.items}
      initialCursor={membersResult.nextCursor}
      initialHasMore={membersResult.hasMore}
      initialInvites={invites}
      currentUserId={currentUserId}
      currentRole={currentRole}
    />
  );
}
