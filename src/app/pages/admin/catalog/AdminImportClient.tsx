"use client";

import { useState, useEffect, useTransition } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Badge } from "@/app/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { Progress } from "@/app/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { Upload } from "lucide-react";
import { startShopifyImport, listImportJobs } from "./server-functions/import";

interface ImportJob {
  id: string;
  source: string;
  status: string;
  totalItems: number;
  processedItems: number;
  failedItems: number;
  errorLog: string | null;
  createdAt: string;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  processing: "default",
  completed: "secondary",
  failed: "destructive",
};

export function AdminImportClient({
  initialJobs,
}: {
  initialJobs: ImportJob[];
}) {
  const [jobs, setJobs] = useState(initialJobs);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [shopUrl, setShopUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [collectionId, setCollectionId] = useState("");

  // Poll active jobs
  const hasActive = jobs.some(
    (j) => j.status === "pending" || j.status === "processing",
  );

  useEffect(() => {
    if (!hasActive) return;
    const interval = setInterval(() => {
      startTransition(async () => {
        const updated = await listImportJobs();
        setJobs(updated);
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [hasActive]);

  function handleStart() {
    if (!shopUrl.trim() || !accessToken.trim()) {
      setError("Shop URL and access token are required");
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        await startShopifyImport({
          shopUrl: shopUrl.trim(),
          accessToken: accessToken.trim(),
          collectionId: collectionId.trim() || undefined,
        });
        setAccessToken("");
        const updated = await listImportJobs();
        setJobs(updated);
      } catch (e: any) {
        setError(e.message || "Failed to start import");
      }
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Import</h1>
      </div>

      <Tabs defaultValue="import" className="mb-4">
        <TabsList>
          <TabsTrigger value="products" asChild>
            <a href="/admin/catalog">Products</a>
          </TabsTrigger>
          <TabsTrigger value="categories" asChild>
            <a href="/admin/catalog/categories">Categories</a>
          </TabsTrigger>
          <TabsTrigger value="import" asChild>
            <a href="/admin/catalog/import">Import</a>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload size={18} /> Shopify Import
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Shop URL</Label>
            <Input
              value={shopUrl}
              onChange={(e) => setShopUrl(e.target.value)}
              placeholder="https://your-store.myshopify.com"
            />
          </div>
          <div>
            <Label>Access Token</Label>
            <Input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="shpat_..."
            />
          </div>
          <div>
            <Label>Collection ID (optional)</Label>
            <Input
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
              placeholder="e.g., 123456789"
            />
          </div>
          <Button onClick={handleStart} disabled={isPending}>
            {isPending ? "Starting..." : "Start Import"}
          </Button>
        </CardContent>
      </Card>

      {/* Import history */}
      <h2 className="text-lg font-semibold mb-3">Import History</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Progress</TableHead>
            <TableHead>Failed</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                No imports yet.
              </TableCell>
            </TableRow>
          ) : (
            jobs.map((job) => {
              const pct =
                job.totalItems > 0
                  ? Math.round(
                      ((job.processedItems + job.failedItems) / job.totalItems) * 100,
                    )
                  : 0;
              return (
                <TableRow key={job.id}>
                  <TableCell className="capitalize">{job.source}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[job.status] ?? "outline"}>
                      {job.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="min-w-[150px]">
                    {job.status === "processing" ? (
                      <div className="space-y-1">
                        <Progress value={pct} className="h-2" />
                        <span className="text-xs text-muted-foreground">
                          {job.processedItems}/{job.totalItems}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm">
                        {job.processedItems}/{job.totalItems}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {job.failedItems > 0 ? (
                      <span className="text-destructive">{job.failedItems}</span>
                    ) : (
                      "0"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(job.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
