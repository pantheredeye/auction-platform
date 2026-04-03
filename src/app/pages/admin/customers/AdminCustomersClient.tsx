"use client";

import { useState, useTransition } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Badge } from "@/app/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";
import { Search, CreditCard } from "lucide-react";
import { listCustomers, type CustomerRow } from "./server-functions/customers";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function AdminCustomersClient({
  initialCustomers,
  initialCursor,
  initialHasMore,
}: {
  initialCustomers: CustomerRow[];
  initialCursor: string | null;
  initialHasMore: boolean;
}) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [cursor, setCursor] = useState(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  function doSearch() {
    startTransition(async () => {
      const result = await listCustomers({
        search: search || undefined,
      });
      setCustomers(result.items);
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
    });
  }

  function loadMore() {
    if (!cursor) return;
    startTransition(async () => {
      const result = await listCustomers({
        cursor,
        search: search || undefined,
      });
      setCustomers((prev) => [...prev, ...result.items]);
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Customers</h1>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={16}
            className="absolute left-2.5 top-2.5 text-muted-foreground"
          />
          <Input
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            className="pl-8"
          />
        </div>
        <Button onClick={doSearch} variant="secondary" disabled={isPending}>
          Search
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Registered</TableHead>
            <TableHead>Card on File</TableHead>
            <TableHead className="w-[60px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={6}
                className="text-center text-muted-foreground py-8"
              >
                No customers found.
              </TableCell>
            </TableRow>
          ) : (
            customers.map((customer) => (
              <TableRow key={customer.userId}>
                <TableCell className="font-medium">
                  {customer.displayName || customer.name || "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {customer.email || "—"}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {customer.role === "dealer" ? "Dealer" : "Consumer"}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(customer.memberCreatedAt)}
                </TableCell>
                <TableCell>
                  {customer.hasCard ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-green-700">
                      <CreditCard size={14} />
                      {customer.cardBrand} ****{customer.cardLast4}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">None</span>
                  )}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="xs" asChild>
                    <a href={`/admin/customers/${customer.userId}`}>View</a>
                  </Button>
                </TableCell>
              </TableRow>
            ))
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
    </div>
  );
}
