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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  ListOrdered,
  Copy,
  Trash2,
  ArrowRight,
  Radio,
} from "lucide-react";
import {
  listAuctions,
  deleteAuction,
  transitionAuctionStatus,
} from "./server-functions/auctions";
import { cloneAuction } from "./server-functions/clone";
import { quickGoLive } from "./server-functions/go-live";

interface Auction {
  id: string;
  type: string;
  title: string;
  status: string;
  scheduledStartAt: string | null;
  lotCount: number;
  version: number;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  scheduled: "bg-blue-100 text-blue-700",
  preview: "bg-yellow-100 text-yellow-700",
  live: "bg-green-100 text-green-700",
  closing: "bg-orange-100 text-orange-700",
  closed: "bg-red-100 text-red-700",
  settled: "bg-purple-100 text-purple-700",
  archived: "bg-gray-100 text-gray-500",
};

const TYPE_LABELS: Record<string, string> = {
  live_consumer: "Live",
  dealer_bulk: "Dealer",
  buy_now: "Buy Now",
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["scheduled", "preview", "live"],
  scheduled: ["preview", "live", "draft"],
  preview: ["live", "draft"],
  live: ["closing", "closed"],
  closing: ["closed"],
  closed: ["settled"],
  settled: ["archived"],
};

const STATUSES = [
  "draft",
  "scheduled",
  "preview",
  "live",
  "closing",
  "closed",
  "settled",
  "archived",
];

export function AdminAuctionsClient({
  initialAuctions,
  initialCursor,
  initialHasMore,
}: {
  initialAuctions: Auction[];
  initialCursor: string | null;
  initialHasMore: boolean;
}) {
  const [auctions, setAuctions] = useState(initialAuctions);
  const [cursor, setCursor] = useState(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function doSearch() {
    startTransition(async () => {
      const result = await listAuctions({
        search: search || undefined,
        status: statusFilter || undefined,
      });
      setAuctions(result.items);
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
    });
  }

  function loadMore() {
    if (!cursor) return;
    startTransition(async () => {
      const result = await listAuctions({
        cursor,
        search: search || undefined,
        status: statusFilter || undefined,
      });
      setAuctions((prev) => [...prev, ...result.items]);
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
    });
  }

  function handleTransition(id: string, toStatus: string, version: number) {
    startTransition(async () => {
      try {
        await transitionAuctionStatus(id, toStatus, undefined, version);
        doSearch();
      } catch (e: any) {
        setError(e.message);
      }
    });
  }

  function handleClone(id: string) {
    startTransition(async () => {
      try {
        const result = await cloneAuction(id);
        window.location.href = `/admin/auctions/${result.id}/edit`;
      } catch (e: any) {
        setError(e.message);
      }
    });
  }

  function handleGoLive() {
    startTransition(async () => {
      try {
        const result = await quickGoLive();
        window.location.href = `/admin/auctions/${result.auctionId}/auctioneer`;
      } catch (e: any) {
        setError(e.message);
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this draft auction?")) return;
    startTransition(async () => {
      try {
        await deleteAuction(id);
        setAuctions((prev) => prev.filter((a) => a.id !== id));
      } catch (e: any) {
        setError(e.message);
      }
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Auctions</h1>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={handleGoLive}
            disabled={isPending}
            className="bg-green-600 hover:bg-green-700"
          >
            <Radio size={16} /> Go Live Now
          </Button>
          <a href="/admin/auctions/new">
            <Button size="sm" variant="outline">
              <Plus size={16} /> New Auction
            </Button>
          </a>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-2.5 top-2.5 text-muted-foreground"
          />
          <Input
            placeholder="Search auctions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            className="pl-8"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={doSearch} variant="secondary" disabled={isPending}>
          Search
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Scheduled</TableHead>
            <TableHead>Lots</TableHead>
            <TableHead className="w-[60px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {auctions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                No auctions found.
              </TableCell>
            </TableRow>
          ) : (
            auctions.map((auction) => {
              const transitions = VALID_TRANSITIONS[auction.status] || [];
              return (
                <TableRow key={auction.id}>
                  <TableCell className="font-medium">{auction.title}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {TYPE_LABELS[auction.type] ?? auction.type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[auction.status] ?? ""}`}
                    >
                      {auction.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {auction.scheduledStartAt
                      ? new Date(auction.scheduledStartAt).toLocaleString()
                      : "—"}
                  </TableCell>
                  <TableCell>{auction.lotCount}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs">
                          <MoreHorizontal size={16} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <a href={`/admin/auctions/${auction.id}/edit`}>
                            <Pencil size={14} /> Edit
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <a href={`/admin/auctions/${auction.id}/lots`}>
                            <ListOrdered size={14} /> Lots
                          </a>
                        </DropdownMenuItem>
                        {auction.status === "live" && (
                          <DropdownMenuItem asChild>
                            <a href={`/admin/auctions/${auction.id}/auctioneer`}>
                              <Radio size={14} /> Control Room
                            </a>
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => handleClone(auction.id)}
                        >
                          <Copy size={14} /> Clone
                        </DropdownMenuItem>

                        {transitions.length > 0 && (
                          <>
                            <DropdownMenuSeparator />
                            {transitions.map((t) => (
                              <DropdownMenuItem
                                key={t}
                                onClick={() =>
                                  handleTransition(
                                    auction.id,
                                    t,
                                    auction.version,
                                  )
                                }
                              >
                                <ArrowRight size={14} /> → {t}
                              </DropdownMenuItem>
                            ))}
                          </>
                        )}

                        {auction.status === "draft" && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => handleDelete(auction.id)}
                            >
                              <Trash2 size={14} /> Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
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
    </div>
  );
}
