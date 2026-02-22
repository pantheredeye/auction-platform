"use client";

import { useState, useTransition } from "react";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { Card, CardContent } from "@/app/components/ui/card";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/app/components/ui/sheet";
import {
  ArrowLeft,
  Plus,
  ChevronUp,
  ChevronDown,
  Pencil,
  Trash2,
  Package,
} from "lucide-react";
import {
  createLot,
  updateLot,
  deleteLot,
  reorderLots,
  addLotItem,
  removeLotItem,
} from "./server-functions/lots";
import { formatCents } from "@/lib/money";
import { imageUrl } from "@/lib/image-url";
import { AdminLotFormClient } from "./AdminLotFormClient";
import { ProductPickerClient } from "./ProductPickerClient";

interface LotItem {
  id: string;
  productId: string;
  quantity: number;
  title: string;
  sku: string | null;
  thumbnailUrl: string | null;
}

interface Lot {
  id: string;
  lotNumber: number;
  title: string;
  description: string | null;
  startingPriceCents: number;
  reservePriceCents: number | null;
  buyNowPriceCents: number | null;
  incrementCents: number | null;
  quantity: number;
  extensionSeconds: number | null;
  status: string;
  thumbnailUrl: string | null;
  items: LotItem[];
  version: number;
}

interface Auction {
  id: string;
  title: string;
  status: string;
}

export function AdminLotsClient({
  auction,
  initialLots,
}: {
  auction: Auction;
  initialLots: Lot[];
}) {
  const [lots, setLots] = useState(initialLots);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  // Sheet state for lot form
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingLot, setEditingLot] = useState<Lot | null>(null);

  // Product picker for a specific lot
  const [pickerLotId, setPickerLotId] = useState<string | null>(null);

  const isDraftOrScheduled =
    auction.status === "draft" || auction.status === "scheduled";

  function openNewLot() {
    setEditingLot(null);
    setSheetOpen(true);
  }

  function openEditLot(lot: Lot) {
    setEditingLot(lot);
    setSheetOpen(true);
  }

  function handleSaveLot(data: {
    title: string;
    description?: string | null;
    startingPriceCents: number;
    reservePriceCents?: number | null;
    buyNowPriceCents?: number | null;
    incrementCents?: number | null;
    quantity?: number;
    extensionSeconds?: number | null;
  }) {
    startTransition(async () => {
      try {
        if (editingLot) {
          await updateLot(editingLot.id, data, editingLot.version);
        } else {
          await createLot(auction.id, data);
        }
        setSheetOpen(false);
        window.location.reload();
      } catch (e: any) {
        setError(e.message || "Failed to save lot");
      }
    });
  }

  function handleDeleteLot(id: string) {
    if (!confirm("Delete this lot?")) return;
    startTransition(async () => {
      try {
        await deleteLot(id);
        setLots((prev) => prev.filter((l) => l.id !== id));
      } catch (e: any) {
        setError(e.message);
      }
    });
  }

  function handleMove(index: number, direction: -1 | 1) {
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= lots.length) return;

    const current = lots[index];
    const target = lots[swapIndex];

    startTransition(async () => {
      try {
        await reorderLots(auction.id, [
          { id: current.id, lotNumber: target.lotNumber },
          { id: target.id, lotNumber: current.lotNumber },
        ]);
        window.location.reload();
      } catch (e: any) {
        setError(e.message);
      }
    });
  }

  function handleAddProduct(
    lotId: string,
    productId: string,
    quantity: number,
  ) {
    startTransition(async () => {
      try {
        await addLotItem(lotId, productId, quantity);
        window.location.reload();
      } catch (e: any) {
        setError(e.message);
      }
    });
  }

  function handleRemoveItem(itemId: string) {
    startTransition(async () => {
      try {
        await removeLotItem(itemId);
        window.location.reload();
      } catch (e: any) {
        setError(e.message);
      }
    });
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <a href="/admin/auctions">
          <Button variant="ghost" size="icon-sm">
            <ArrowLeft size={16} />
          </Button>
        </a>
        <h1 className="text-2xl font-bold">Lots</h1>
        <Badge variant="outline">{auction.status}</Badge>
      </div>
      <p className="text-muted-foreground mb-4 ml-10">{auction.title}</p>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isDraftOrScheduled && (
        <div className="mb-4">
          <Button onClick={openNewLot} size="sm">
            <Plus size={16} /> Add Lot
          </Button>
        </div>
      )}

      {lots.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Package className="mx-auto mb-2" size={32} />
            <p>No lots yet. Add one to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {lots.map((lot, index) => (
            <Card key={lot.id}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  {/* Thumbnail */}
                  {lot.thumbnailUrl ? (
                    <img
                      src={imageUrl(lot.thumbnailUrl)}
                      alt=""
                      className="w-16 h-16 object-cover rounded shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-muted rounded shrink-0 flex items-center justify-center">
                      <Package size={20} className="text-muted-foreground" />
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">
                        #{lot.lotNumber}
                      </span>
                      <span className="font-medium truncate">
                        {lot.title}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {lot.status}
                      </Badge>
                    </div>
                    <div className="flex gap-4 mt-1 text-sm text-muted-foreground">
                      <span>Start: {formatCents(lot.startingPriceCents)}</span>
                      {lot.reservePriceCents && (
                        <span>
                          Reserve: {formatCents(lot.reservePriceCents)}
                        </span>
                      )}
                      <span>{lot.items.length} items</span>
                    </div>

                    {/* Lot items */}
                    {lot.items.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {lot.items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-2 text-xs"
                          >
                            {item.thumbnailUrl && (
                              <img
                                src={imageUrl(item.thumbnailUrl)}
                                alt=""
                                className="w-6 h-6 object-cover rounded"
                              />
                            )}
                            <span className="truncate">{item.title}</span>
                            {item.sku && (
                              <span className="text-muted-foreground">
                                ({item.sku})
                              </span>
                            )}
                            <span className="text-muted-foreground">
                              x{item.quantity}
                            </span>
                            {isDraftOrScheduled && (
                              <button
                                onClick={() => handleRemoveItem(item.id)}
                                className="text-destructive hover:underline ml-1"
                                disabled={isPending}
                              >
                                remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Product picker toggle */}
                    {isDraftOrScheduled && (
                      <div className="mt-2">
                        {pickerLotId === lot.id ? (
                          <div>
                            <ProductPickerClient
                              onSelect={(productId, qty) => {
                                handleAddProduct(lot.id, productId, qty);
                                setPickerLotId(null);
                              }}
                              onCancel={() => setPickerLotId(null)}
                            />
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => setPickerLotId(lot.id)}
                          >
                            <Plus size={12} /> Add Product
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {isDraftOrScheduled && (
                    <div className="flex flex-col gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleMove(index, -1)}
                        disabled={index === 0 || isPending}
                      >
                        <ChevronUp size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleMove(index, 1)}
                        disabled={index === lots.length - 1 || isPending}
                      >
                        <ChevronDown size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => openEditLot(lot)}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleDeleteLot(lot.id)}
                        disabled={isPending}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Lot form sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingLot ? "Edit Lot" : "New Lot"}</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <AdminLotFormClient
              lot={editingLot}
              onSave={handleSaveLot}
              onCancel={() => setSheetOpen(false)}
              isPending={isPending}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
