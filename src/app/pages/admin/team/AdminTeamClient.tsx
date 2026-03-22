"use client";

import { useState, useTransition } from "react";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { MoreHorizontal, Plus, Copy, UserPlus, Trash2, Shield } from "lucide-react";
import {
  listMembers,
  updateMemberRole,
  removeMember,
  createInvite,
  revokeInvite,
  type MemberRow,
  type InviteRow,
} from "./server-functions/team";

const EMPLOYEE_ROLES = [
  { value: "super_admin", label: "Super Admin" },
  { value: "admin", label: "Admin" },
  { value: "auctioneer", label: "Auctioneer" },
  { value: "catalog_manager", label: "Catalog Manager" },
  { value: "customer_service", label: "Customer Service" },
  { value: "shipping", label: "Shipping" },
];

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-purple-100 text-purple-700",
  admin: "bg-blue-100 text-blue-700",
  auctioneer: "bg-green-100 text-green-700",
  catalog_manager: "bg-amber-100 text-amber-700",
  customer_service: "bg-cyan-100 text-cyan-700",
  shipping: "bg-orange-100 text-orange-700",
};

function roleLabel(role: string): string {
  return EMPLOYEE_ROLES.find((r) => r.value === role)?.label ?? role;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const hoursLeft = Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60));
  if (hoursLeft < 1) return "< 1h left";
  if (hoursLeft < 24) return `${hoursLeft}h left`;
  return `${Math.round(hoursLeft / 24)}d left`;
}

export function AdminTeamClient({
  initialMembers,
  initialCursor,
  initialHasMore,
  initialInvites,
  currentUserId,
  currentRole,
}: {
  initialMembers: MemberRow[];
  initialCursor: string | null;
  initialHasMore: boolean;
  initialInvites: InviteRow[];
  currentUserId: string;
  currentRole: string;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [cursor, setCursor] = useState(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [invites, setInvites] = useState(initialInvites);
  const [tab, setTab] = useState<"members" | "invites">("members");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  // Role edit dialog
  const [editingMember, setEditingMember] = useState<MemberRow | null>(null);
  const [editRole, setEditRole] = useState("");

  // Remove confirm
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState("auctioneer");
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isAdmin = currentRole === "super_admin" || currentRole === "admin";

  function loadMore() {
    if (!cursor) return;
    startTransition(async () => {
      const result = await listMembers({ cursor });
      setMembers((prev) => [...prev, ...result.items]);
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
    });
  }

  function openEditRole(member: MemberRow) {
    setEditingMember(member);
    setEditRole(member.role);
    setError("");
  }

  function handleEditRole() {
    if (!editingMember) return;
    startTransition(async () => {
      try {
        await updateMemberRole(editingMember.membershipId, editRole);
        setMembers((prev) =>
          prev.map((m) =>
            m.membershipId === editingMember.membershipId
              ? { ...m, role: editRole }
              : m,
          ),
        );
        setEditingMember(null);
      } catch (e: any) {
        setError(e.message);
      }
    });
  }

  function handleRemove(membershipId: string) {
    startTransition(async () => {
      try {
        await removeMember(membershipId);
        setMembers((prev) => prev.filter((m) => m.membershipId !== membershipId));
        setRemovingId(null);
      } catch (e: any) {
        setError(e.message);
      }
    });
  }

  function handleCreateInvite() {
    startTransition(async () => {
      try {
        const result = await createInvite({ role: inviteRole });
        setGeneratedCode(result.code);
        // Refresh invites list
        const updated = await listInvites();
        setInvites(updated);
      } catch (e: any) {
        setError(e.message);
      }
    });
  }

  function handleRevokeInvite(inviteId: string) {
    startTransition(async () => {
      try {
        await revokeInvite(inviteId);
        setInvites((prev) => prev.filter((i) => i.id !== inviteId));
      } catch (e: any) {
        setError(e.message);
      }
    });
  }

  function copyInviteLink() {
    if (!generatedCode) return;
    const url = `${window.location.origin}/invite/${generatedCode}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function closeInviteDialog() {
    setInviteOpen(false);
    setGeneratedCode(null);
    setCopied(false);
    setInviteRole("auctioneer");
  }

  // Filter roles that current user can assign
  const assignableRoles =
    currentRole === "super_admin"
      ? EMPLOYEE_ROLES
      : EMPLOYEE_ROLES.filter((r) => r.value !== "super_admin");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Team</h1>
        {isAdmin && (
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus size={16} className="mr-1.5" /> Invite Member
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "members" | "invites")}
        className="mb-4"
      >
        <TabsList>
          <TabsTrigger value="members">
            Members ({members.length})
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="invites">
              Invites ({invites.length})
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>

      {tab === "members" && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                {isAdmin && <TableHead className="w-[60px]"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={isAdmin ? 6 : 5}
                    className="text-center text-muted-foreground py-8"
                  >
                    No team members found.
                  </TableCell>
                </TableRow>
              ) : (
                members.map((member) => {
                  const isSelf = member.userId === currentUserId;
                  return (
                    <TableRow key={member.membershipId}>
                      <TableCell className="font-medium">
                        {member.displayName || member.name || "—"}
                        {isSelf && (
                          <span className="text-xs text-muted-foreground ml-1.5">
                            (you)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {member.email || "—"}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[member.role] ?? "bg-gray-100 text-gray-700"}`}
                        >
                          {roleLabel(member.role)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {member.isApproved ? (
                          <Badge variant="outline" className="text-green-700 border-green-300">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-700 border-amber-300">
                            Pending
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDate(member.memberCreatedAt)}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          {!isSelf && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon-xs">
                                  <MoreHorizontal size={16} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => openEditRole(member)}
                                >
                                  <Shield size={14} /> Change Role
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {removingId === member.membershipId ? (
                                  <div className="flex gap-1 px-2 py-1">
                                    <Button
                                      variant="destructive"
                                      size="xs"
                                      onClick={() =>
                                        handleRemove(member.membershipId)
                                      }
                                      disabled={isPending}
                                    >
                                      Confirm
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="xs"
                                      onClick={() => setRemovingId(null)}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                ) : (
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() =>
                                      setRemovingId(member.membershipId)
                                    }
                                  >
                                    <Trash2 size={14} /> Remove
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          {hasMore && (
            <div className="mt-4 text-center">
              <Button variant="outline" onClick={loadMore} disabled={isPending}>
                {isPending ? "Loading..." : "Load More"}
              </Button>
            </div>
          )}
        </>
      )}

      {tab === "invites" && isAdmin && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Created By</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-8"
                >
                  No active invites.
                </TableCell>
              </TableRow>
            ) : (
              invites.map((invite) => (
                <TableRow key={invite.id}>
                  <TableCell className="font-mono text-sm">
                    {invite.code}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[invite.role] ?? "bg-gray-100 text-gray-700"}`}
                    >
                      {roleLabel(invite.role)}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {invite.createdByName || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatExpiry(invite.expiresAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `${window.location.origin}/invite/${invite.code}`,
                          );
                        }}
                        title="Copy invite link"
                      >
                        <Copy size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleRevokeInvite(invite.id)}
                        disabled={isPending}
                        title="Revoke"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      {/* Edit Role Dialog */}
      <Dialog
        open={!!editingMember}
        onOpenChange={(open) => !open && setEditingMember(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Role</DialogTitle>
            <DialogDescription>
              Update role for{" "}
              {editingMember?.displayName || editingMember?.name || "this member"}
            </DialogDescription>
          </DialogHeader>
          <Select value={editRole} onValueChange={setEditRole}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {assignableRoles.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingMember(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleEditRole}
              disabled={isPending || editRole === editingMember?.role}
            >
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={(open) => !open && closeInviteDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              Generate an invite link to share with a new team member.
            </DialogDescription>
          </DialogHeader>

          {!generatedCode ? (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Role</label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {assignableRoles.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeInviteDialog}>
                  Cancel
                </Button>
                <Button onClick={handleCreateInvite} disabled={isPending}>
                  {isPending ? "Creating..." : "Create Invite"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Share this link with the person you want to invite. It expires in 72 hours.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md bg-muted px-3 py-2 text-sm break-all">
                    {typeof window !== "undefined"
                      ? `${window.location.origin}/invite/${generatedCode}`
                      : `/invite/${generatedCode}`}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyInviteLink}
                  >
                    <Copy size={14} className="mr-1" />
                    {copied ? "Copied!" : "Copy"}
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={closeInviteDialog}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
