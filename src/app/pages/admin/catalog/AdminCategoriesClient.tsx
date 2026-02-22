"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import {
  ChevronUp,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  FolderTree,
} from "lucide-react";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
} from "./server-functions/categories";

interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
}

interface TreeNode extends Category {
  children: TreeNode[];
  depth: number;
}

function buildTree(categories: Category[]): TreeNode[] {
  const map = new Map<string | null, Category[]>();
  for (const cat of categories) {
    const key = cat.parentId;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(cat);
  }

  function build(parentId: string | null, depth: number): TreeNode[] {
    const children = map.get(parentId) || [];
    return children
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((cat) => ({
        ...cat,
        depth,
        children: build(cat.id, depth + 1),
      }));
  }

  return build(null, 0);
}

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    result.push(...flattenTree(node.children));
  }
  return result;
}

export function AdminCategoriesClient({
  categories: initialCategories,
}: {
  categories: Category[];
}) {
  const [categories, setCategories] = useState(initialCategories);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogName, setDialogName] = useState("");
  const [dialogParentId, setDialogParentId] = useState<string | null>(null);

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const tree = buildTree(categories);
  const flat = flattenTree(tree);

  function openAdd(parentId: string | null = null) {
    setEditingId(null);
    setDialogName("");
    setDialogParentId(parentId);
    setDialogOpen(true);
    setError("");
  }

  function openEdit(cat: Category) {
    setEditingId(cat.id);
    setDialogName(cat.name);
    setDialogParentId(cat.parentId);
    setDialogOpen(true);
    setError("");
  }

  function handleSave() {
    if (!dialogName.trim()) {
      setError("Name is required");
      return;
    }
    startTransition(async () => {
      try {
        if (editingId) {
          await updateCategory(editingId, { name: dialogName.trim() }, 0);
        } else {
          await createCategory({
            name: dialogName.trim(),
            parentId: dialogParentId,
          });
        }
        window.location.reload();
      } catch (e: any) {
        setError(e.message || "Failed to save");
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      try {
        await deleteCategory(id);
        window.location.reload();
      } catch (e: any) {
        setError(e.message || "Failed to delete");
      }
    });
  }

  function handleMove(index: number, direction: -1 | 1) {
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= flat.length) return;

    // Only swap siblings (same parentId)
    const current = flat[index];
    const target = flat[swapIndex];
    if (current.parentId !== target.parentId) return;

    startTransition(async () => {
      try {
        await reorderCategories([
          { id: current.id, sortOrder: target.sortOrder },
          { id: target.id, sortOrder: current.sortOrder },
        ]);
        window.location.reload();
      } catch (e: any) {
        setError(e.message || "Failed to reorder");
      }
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Categories</h1>
        <Button onClick={() => openAdd()} size="sm">
          <Plus size={16} /> Add Category
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          {flat.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              <FolderTree className="mx-auto mb-2" size={32} />
              <p>No categories yet. Add one to get started.</p>
            </div>
          ) : (
            <div className="divide-y">
              {flat.map((node, index) => (
                <div
                  key={node.id}
                  className="flex items-center gap-2 px-4 py-2 hover:bg-muted/50"
                  style={{ paddingLeft: `${16 + node.depth * 24}px` }}
                >
                  <span className="flex-1 text-sm">{node.name}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => openAdd(node.id)}
                      title="Add child"
                    >
                      <Plus size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleMove(index, -1)}
                      disabled={isPending}
                    >
                      <ChevronUp size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleMove(index, 1)}
                      disabled={isPending}
                    >
                      <ChevronDown size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => openEdit(node)}
                    >
                      <Pencil size={14} />
                    </Button>
                    {deleteId === node.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="destructive"
                          size="xs"
                          onClick={() => {
                            handleDelete(node.id);
                            setDeleteId(null);
                          }}
                          disabled={isPending}
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setDeleteId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setDeleteId(node.id)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Category" : "Add Category"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                value={dialogName}
                onChange={(e) => setDialogName(e.target.value)}
                placeholder="Category name"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </div>
            {dialogParentId && (
              <p className="text-xs text-muted-foreground">
                Parent:{" "}
                {categories.find((c) => c.id === dialogParentId)?.name}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
