"use client";

import { useState, useTransition } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { Switch } from "@/app/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { ArrowLeft, X, Upload } from "lucide-react";
import {
  createProduct,
  updateProduct,
  uploadProductImage,
  removeProductImage,
} from "./server-functions/catalog";
import { centsToDollars } from "@/lib/money";
import { imageUrl } from "@/lib/image-url";

interface Product {
  id: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  sku: string | null;
  conditionType: string | null;
  retailPriceCents: number | null;
  quantity: number;
  isPerishable: number;
  expiryDate: string | null;
  coldChainRequired: number;
  storageTemp: string | null;
  handlingInstructions: string | null;
  imageUrls: string | null;
  tags: string | null;
  version: number;
}

interface Category {
  id: string;
  name: string;
  parentId: string | null;
}

const CONDITION_TYPES = [
  { value: "new", label: "New" },
  { value: "like_new", label: "Like New" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "salvage", label: "Salvage" },
];

export function AdminProductFormClient({
  product,
  categories,
}: {
  product: Product | null;
  categories: Category[];
}) {
  const isEdit = !!product;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [title, setTitle] = useState(product?.title ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [conditionType, setConditionType] = useState(
    product?.conditionType ?? "",
  );
  const [retailPrice, setRetailPrice] = useState(
    product?.retailPriceCents ? centsToDollars(product.retailPriceCents).toString() : "",
  );
  const [quantity, setQuantity] = useState(
    product?.quantity?.toString() ?? "1",
  );
  const [isPerishable, setIsPerishable] = useState(
    product?.isPerishable === 1,
  );
  const [expiryDate, setExpiryDate] = useState(product?.expiryDate ?? "");
  const [coldChainRequired, setColdChainRequired] = useState(
    product?.coldChainRequired === 1,
  );
  const [storageTemp, setStorageTemp] = useState(product?.storageTemp ?? "");
  const [handlingInstructions, setHandlingInstructions] = useState(
    product?.handlingInstructions ?? "",
  );
  const [tags, setTags] = useState(product?.tags ?? "");

  const existingImages: string[] = product?.imageUrls
    ? JSON.parse(product.imageUrls)
    : [];
  const [images, setImages] = useState<string[]>(existingImages);

  function handleSubmit() {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    const priceCents = retailPrice
      ? Math.round(parseFloat(retailPrice) * 100)
      : null;

    startTransition(async () => {
      try {
        const data = {
          title: title.trim(),
          description: description || null,
          categoryId: categoryId || null,
          sku: sku || null,
          conditionType: conditionType || null,
          retailPriceCents: priceCents,
          quantity: parseInt(quantity) || 1,
          isPerishable,
          expiryDate: isPerishable && expiryDate ? expiryDate : null,
          coldChainRequired: isPerishable && coldChainRequired,
          storageTemp: isPerishable && storageTemp ? storageTemp : null,
          handlingInstructions:
            isPerishable && handlingInstructions
              ? handlingInstructions
              : null,
          tags: tags || null,
        };

        if (isEdit) {
          await updateProduct(product!.id, data, product!.version);
        } else {
          await createProduct(data);
        }
        window.location.href = "/admin/catalog";
      } catch (e: any) {
        setError(e.message || "Failed to save");
      }
    });
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length || !product) return;

    startTransition(async () => {
      try {
        for (const file of Array.from(files)) {
          const result = await uploadProductImage(product.id, file);
          setImages((prev) => [...prev, result.key]);
        }
      } catch (e: any) {
        setError(e.message || "Upload failed");
      }
    });
  }

  async function handleRemoveImage(key: string) {
    if (!product) return;
    startTransition(async () => {
      try {
        await removeProductImage(product.id, key);
        setImages((prev) => prev.filter((k) => k !== key));
      } catch (e: any) {
        setError(e.message || "Remove failed");
      }
    });
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-4">
        <a href="/admin/catalog">
          <Button variant="ghost" size="icon-sm">
            <ArrowLeft size={16} />
          </Button>
        </a>
        <h1 className="text-2xl font-bold">
          {isEdit ? "Edit Product" : "New Product"}
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
              <Label>Title *</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Product title"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Product description"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select
                  value={categoryId}
                  onValueChange={(v) => setCategoryId(v === "none" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>SKU</Label>
                <Input
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="SKU-001"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Condition</Label>
                <Select
                  value={conditionType}
                  onValueChange={(v) =>
                    setConditionType(v === "none" ? "" : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {CONDITION_TYPES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Retail Price ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={retailPrice}
                  onChange={(e) => setRetailPrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>Quantity</Label>
                <Input
                  type="number"
                  min="0"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Tags (comma-separated)</Label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="electronics, vintage, rare"
              />
            </div>
          </CardContent>
        </Card>

        {/* Perishable section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Perishable
              <Switch
                checked={isPerishable}
                onCheckedChange={setIsPerishable}
              />
            </CardTitle>
          </CardHeader>
          {isPerishable && (
            <CardContent className="space-y-4">
              <div>
                <Label>Expiry Date</Label>
                <Input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3">
                <Label>Cold Chain Required</Label>
                <Switch
                  checked={coldChainRequired}
                  onCheckedChange={setColdChainRequired}
                />
              </div>
              {coldChainRequired && (
                <div>
                  <Label>Storage Temperature</Label>
                  <Input
                    value={storageTemp}
                    onChange={(e) => setStorageTemp(e.target.value)}
                    placeholder="e.g., 35-40°F"
                  />
                </div>
              )}
              <div>
                <Label>Handling Instructions</Label>
                <Textarea
                  value={handlingInstructions}
                  onChange={(e) => setHandlingInstructions(e.target.value)}
                  placeholder="Special handling notes"
                  rows={2}
                />
              </div>
            </CardContent>
          )}
        </Card>

        {/* Images - only for existing products */}
        {isEdit && (
          <Card>
            <CardHeader>
              <CardTitle>Images</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3 mb-3">
                {images.map((key) => (
                  <div key={key} className="relative group">
                    <img
                      src={imageUrl(key)}
                      alt=""
                      className="w-full aspect-square object-cover rounded"
                    />
                    <button
                      onClick={() => handleRemoveImage(key)}
                      className="absolute top-1 right-1 bg-destructive text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                <Upload size={16} />
                Upload images
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3">
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving..." : isEdit ? "Update Product" : "Create Product"}
          </Button>
          <a href="/admin/catalog">
            <Button variant="outline">Cancel</Button>
          </a>
        </div>
      </div>
    </div>
  );
}
