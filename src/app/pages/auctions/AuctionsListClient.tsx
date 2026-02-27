"use client";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { Eye, Clock, Package } from "lucide-react";

interface AuctionSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  type: string;
  scheduledStartAt: string | null;
  viewerCount: number;
  totalLots: number;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  live: {
    label: "Live",
    className: "bg-red-500 text-white animate-pulse",
  },
  scheduled: {
    label: "Scheduled",
    className: "bg-blue-100 text-blue-700",
  },
  preview: {
    label: "Preview",
    className: "bg-yellow-100 text-yellow-700",
  },
};

const TYPE_LABELS: Record<string, string> = {
  live_consumer: "Live",
  dealer_bulk: "Dealer",
  buy_now: "Buy Now",
};

export function AuctionsListClient({
  auctions,
}: {
  auctions: AuctionSummary[];
}) {
  if (auctions.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Live Auctions</h1>
        <div className="text-center py-16 text-muted-foreground">
          No live auctions right now. Check back soon!
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Live Auctions</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {auctions.map((auction) => {
          const config = STATUS_CONFIG[auction.status];
          const isLive = auction.status === "live";
          return (
            <Card key={auction.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate">{auction.title}</CardTitle>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${config?.className ?? ""}`}
                  >
                    {config?.label ?? auction.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Badge variant="outline">
                    {TYPE_LABELS[auction.type] ?? auction.type}
                  </Badge>
                  {isLive && auction.viewerCount > 0 && (
                    <span className="flex items-center gap-1">
                      <Eye size={14} />
                      {auction.viewerCount}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Package size={14} />
                    {auction.totalLots} lots
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                {auction.scheduledStartAt && !isLive && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Clock size={14} />
                    {new Date(auction.scheduledStartAt).toLocaleString()}
                  </div>
                )}
              </CardContent>
              <CardFooter>
                {isLive ? (
                  <a href={`/auctions/${auction.slug}/live`} className="w-full">
                    <Button className="w-full bg-red-600 hover:bg-red-700">
                      Join Live
                    </Button>
                  </a>
                ) : (
                  <a href={`/auctions/${auction.slug}/live`} className="w-full">
                    <Button variant="outline" className="w-full">
                      View Details
                    </Button>
                  </a>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
