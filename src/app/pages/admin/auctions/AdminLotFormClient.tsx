"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { centsToDollars } from "@/lib/money";

interface Lot {
  id: string;
  title: string;
  description: string | null;
  startingPriceCents: number;
  reservePriceCents: number | null;
  buyNowPriceCents: number | null;
  incrementCents: number | null;
  quantity: number;
  extensionSeconds: number | null;
  version: number;
}

export function AdminLotFormClient({
  lot,
  onSave,
  onCancel,
  isPending,
}: {
  lot: Lot | null;
  onSave: (data: {
    title: string;
    description?: string | null;
    startingPriceCents: number;
    reservePriceCents?: number | null;
    buyNowPriceCents?: number | null;
    incrementCents?: number | null;
    quantity?: number;
    extensionSeconds?: number | null;
  }) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [title, setTitle] = useState(lot?.title ?? "");
  const [description, setDescription] = useState(lot?.description ?? "");
  const [startingPrice, setStartingPrice] = useState(
    lot ? centsToDollars(lot.startingPriceCents).toString() : "",
  );
  const [reservePrice, setReservePrice] = useState(
    lot?.reservePriceCents
      ? centsToDollars(lot.reservePriceCents).toString()
      : "",
  );
  const [buyNowPrice, setBuyNowPrice] = useState(
    lot?.buyNowPriceCents
      ? centsToDollars(lot.buyNowPriceCents).toString()
      : "",
  );
  const [incrementOverride, setIncrementOverride] = useState(
    lot?.incrementCents
      ? centsToDollars(lot.incrementCents).toString()
      : "",
  );
  const [quantity, setQuantity] = useState(
    lot?.quantity?.toString() ?? "1",
  );
  const [extensionSeconds, setExtensionSeconds] = useState(
    lot?.extensionSeconds?.toString() ?? "",
  );
  const [error, setError] = useState("");

  function handleSubmit() {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    const startCents = Math.round(parseFloat(startingPrice || "0") * 100);
    if (startCents <= 0) {
      setError("Starting price must be positive");
      return;
    }
    setError("");

    onSave({
      title: title.trim(),
      description: description || null,
      startingPriceCents: startCents,
      reservePriceCents: reservePrice
        ? Math.round(parseFloat(reservePrice) * 100)
        : null,
      buyNowPriceCents: buyNowPrice
        ? Math.round(parseFloat(buyNowPrice) * 100)
        : null,
      incrementCents: incrementOverride
        ? Math.round(parseFloat(incrementOverride) * 100)
        : null,
      quantity: parseInt(quantity) || 1,
      extensionSeconds: extensionSeconds
        ? parseInt(extensionSeconds)
        : null,
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      <div>
        <Label>Title *</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Lot title"
        />
      </div>
      <div>
        <Label>Description</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Lot description"
          rows={2}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Starting Price ($) *</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={startingPrice}
            onChange={(e) => setStartingPrice(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div>
          <Label>Reserve ($)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={reservePrice}
            onChange={(e) => setReservePrice(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Buy Now ($)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={buyNowPrice}
            onChange={(e) => setBuyNowPrice(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div>
          <Label>Increment Override ($)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={incrementOverride}
            onChange={(e) => setIncrementOverride(e.target.value)}
            placeholder="Default"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Quantity</Label>
          <Input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <div>
          <Label>Extension (sec)</Label>
          <Input
            type="number"
            min="0"
            value={extensionSeconds}
            onChange={(e) => setExtensionSeconds(e.target.value)}
            placeholder="Default"
          />
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <Button onClick={handleSubmit} disabled={isPending}>
          {isPending ? "Saving..." : lot ? "Update" : "Create"}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
