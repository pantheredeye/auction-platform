"use client";

import { useState, useTransition } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { createAuction, updateAuction } from "./server-functions/auctions";
import { centsToDollars } from "@/lib/money";

interface Auction {
  id: string;
  type: string;
  title: string;
  description: string | null;
  scheduledStartAt: string | null;
  defaultIncrementCents: number;
  incrementRules: string | null;
  buyerPremiumPct: number;
  extensionSeconds: number;
  auctioneerId: string | null;
  version: number;
}

interface Auctioneer {
  id: string;
  username: string;
  displayName: string | null;
}

interface IncrementRule {
  upTo: string;
  increment: string;
}

const AUCTION_TYPES = [
  { value: "live_consumer", label: "Live Consumer" },
  { value: "dealer_bulk", label: "Dealer Bulk" },
  { value: "buy_now", label: "Buy Now" },
];

function parseRules(json: string | null): IncrementRule[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as { upTo: number; increment: number }[];
    return parsed.map((r) => ({
      upTo: centsToDollars(r.upTo).toString(),
      increment: centsToDollars(r.increment).toString(),
    }));
  } catch {
    return [];
  }
}

export function AdminAuctionFormClient({
  auction,
  auctioneers,
}: {
  auction: Auction | null;
  auctioneers: Auctioneer[];
}) {
  const isEdit = !!auction;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [type, setType] = useState(auction?.type ?? "live_consumer");
  const [title, setTitle] = useState(auction?.title ?? "");
  const [description, setDescription] = useState(auction?.description ?? "");
  const [scheduledDate, setScheduledDate] = useState(
    auction?.scheduledStartAt
      ? auction.scheduledStartAt.slice(0, 10)
      : "",
  );
  const [scheduledTime, setScheduledTime] = useState(
    auction?.scheduledStartAt
      ? auction.scheduledStartAt.slice(11, 16)
      : "",
  );
  const [defaultIncrement, setDefaultIncrement] = useState(
    auction ? centsToDollars(auction.defaultIncrementCents).toString() : "5",
  );
  const [buyerPremiumPct, setBuyerPremiumPct] = useState(
    auction?.buyerPremiumPct?.toString() ?? "0",
  );
  const [extensionSeconds, setExtensionSeconds] = useState(
    auction?.extensionSeconds?.toString() ?? "0",
  );
  const [auctioneerId, setAuctioneerId] = useState(
    auction?.auctioneerId ?? "",
  );
  const [rules, setRules] = useState<IncrementRule[]>(
    parseRules(auction?.incrementRules ?? null),
  );

  function addRule() {
    setRules((prev) => [...prev, { upTo: "", increment: "" }]);
  }

  function removeRule(index: number) {
    setRules((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRule(index: number, field: keyof IncrementRule, value: string) {
    setRules((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    );
  }

  function handleSubmit() {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    const incrementCents = Math.round(parseFloat(defaultIncrement || "0") * 100);
    if (incrementCents <= 0) {
      setError("Default increment must be positive");
      return;
    }

    let scheduledStartAt: string | null = null;
    if (scheduledDate && scheduledTime) {
      scheduledStartAt = `${scheduledDate}T${scheduledTime}:00.000Z`;
    }

    const incrementRules = rules.length > 0
      ? JSON.stringify(
          rules
            .filter((r) => r.upTo && r.increment)
            .map((r) => ({
              upTo: Math.round(parseFloat(r.upTo) * 100),
              increment: Math.round(parseFloat(r.increment) * 100),
            })),
        )
      : null;

    startTransition(async () => {
      try {
        const data = {
          type,
          title: title.trim(),
          description: description || null,
          scheduledStartAt,
          defaultIncrementCents: incrementCents,
          incrementRules,
          buyerPremiumPct: parseFloat(buyerPremiumPct) || 0,
          extensionSeconds: parseInt(extensionSeconds) || 0,
          auctioneerId: auctioneerId || null,
        };

        if (isEdit) {
          await updateAuction(auction!.id, data, auction!.version);
          window.location.href = "/admin/auctions";
        } else {
          const result = await createAuction(data);
          window.location.href = `/admin/auctions/${result.id}/lots`;
        }
      } catch (e: any) {
        setError(e.message || "Failed to save");
      }
    });
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-4">
        <a href="/admin/auctions">
          <Button variant="ghost" size="icon-sm">
            <ArrowLeft size={16} />
          </Button>
        </a>
        <h1 className="text-2xl font-bold">
          {isEdit ? "Edit Auction" : "New Auction"}
        </h1>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUCTION_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title *</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Auction title"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Auction description"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Scheduled Date</Label>
                <Input
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                />
              </div>
              <div>
                <Label>Scheduled Time</Label>
                <Input
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                />
              </div>
            </div>
            {auctioneers.length > 0 && (
              <div>
                <Label>Auctioneer</Label>
                <Select
                  value={auctioneerId}
                  onValueChange={(v) =>
                    setAuctioneerId(v === "none" ? "" : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select auctioneer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {auctioneers.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.displayName || a.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bidding</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Default Increment ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={defaultIncrement}
                  onChange={(e) => setDefaultIncrement(e.target.value)}
                />
              </div>
              <div>
                <Label>Buyer Premium %</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={buyerPremiumPct}
                  onChange={(e) => setBuyerPremiumPct(e.target.value)}
                />
              </div>
              <div>
                <Label>Extension (sec)</Label>
                <Input
                  type="number"
                  min="0"
                  value={extensionSeconds}
                  onChange={(e) => setExtensionSeconds(e.target.value)}
                />
              </div>
            </div>

            {/* Increment rules */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Increment Rules</Label>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={addRule}
                  type="button"
                >
                  <Plus size={14} /> Add Rule
                </Button>
              </div>
              {rules.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No rules — default increment applies to all bids.
                </p>
              )}
              {rules.map((rule, i) => (
                <div key={i} className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    Up to $
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={rule.upTo}
                    onChange={(e) => updateRule(i, "upTo", e.target.value)}
                    className="w-28"
                    placeholder="100"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    increment $
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={rule.increment}
                    onChange={(e) => updateRule(i, "increment", e.target.value)}
                    className="w-28"
                    placeholder="5"
                  />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => removeRule(i)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending
              ? "Saving..."
              : isEdit
                ? "Update Auction"
                : "Create Auction"}
          </Button>
          <a href="/admin/auctions">
            <Button variant="outline">Cancel</Button>
          </a>
        </div>
      </div>
    </div>
  );
}
