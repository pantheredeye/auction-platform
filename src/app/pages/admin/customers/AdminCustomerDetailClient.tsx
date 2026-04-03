import { Badge } from "@/app/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";
import { ArrowLeft, CreditCard, User, Gavel, Trophy } from "lucide-react";
import type { CustomerDetail } from "./server-functions/customers";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function AdminCustomerDetailClient({
  detail,
}: {
  detail: CustomerDetail;
}) {
  const { user, role, paymentMethods, bidSummary, recentBids } = detail;
  const activeMethods = paymentMethods.filter((m) => m.status === "active");

  return (
    <div>
      <a
        href="/admin/customers"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft size={16} /> Back to Customers
      </a>

      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">
          {user.displayName || user.name || "Unknown"}
        </h1>
        <Badge variant="outline">
          {role === "dealer" ? "Dealer" : "Consumer"}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
        {/* Profile Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <User size={14} /> Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {user.name && (
              <div>
                <span className="text-muted-foreground">Name:</span>{" "}
                {user.name}
              </div>
            )}
            {user.displayName && user.displayName !== user.name && (
              <div>
                <span className="text-muted-foreground">Display:</span>{" "}
                {user.displayName}
              </div>
            )}
            {user.email && (
              <div>
                <span className="text-muted-foreground">Email:</span>{" "}
                {user.email}
              </div>
            )}
            {user.phone && (
              <div>
                <span className="text-muted-foreground">Phone:</span>{" "}
                {user.phone}
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Auth:</span>{" "}
              {user.authMethod}
            </div>
            <div>
              <span className="text-muted-foreground">Registered:</span>{" "}
              {formatDate(user.createdAt)}
            </div>
          </CardContent>
        </Card>

        {/* Bid Summary Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Gavel size={14} /> Bid Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total Bids</span>
              <span className="text-lg font-semibold">
                {bidSummary.totalBids}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Wins</span>
              <span className="text-lg font-semibold flex items-center gap-1">
                <Trophy size={14} className="text-amber-500" />
                {bidSummary.totalWins}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Total Spent
              </span>
              <span className="text-lg font-semibold">
                {formatCents(bidSummary.totalSpentCents)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Payment Methods Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <CreditCard size={14} /> Payment Methods
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeMethods.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No cards on file.
              </p>
            ) : (
              <div className="space-y-2">
                {activeMethods.map((pm) => (
                  <div
                    key={pm.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="flex items-center gap-1.5">
                      <CreditCard size={14} className="text-muted-foreground" />
                      <span className="capitalize">{pm.brand}</span> ****
                      {pm.last4}
                    </span>
                    <span className="text-muted-foreground">
                      {String(pm.expMonth).padStart(2, "0")}/{pm.expYear}
                      {pm.isDefault ? (
                        <Badge variant="outline" className="ml-2 text-xs">
                          Default
                        </Badge>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Bids Table */}
      {recentBids.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Recent Bids</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Auction</TableHead>
                  <TableHead>Lot</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentBids.map((bid, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">
                      {bid.auctionTitle}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {bid.lotTitle || "—"}
                    </TableCell>
                    <TableCell>{formatCents(bid.amountCents)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDateTime(bid.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
