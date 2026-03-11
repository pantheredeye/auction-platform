"use client";

import { useState, useTransition } from "react";
import { Button } from "@/app/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { Badge } from "@/app/components/ui/badge";
import { Label } from "@/app/components/ui/label";
import { toast } from "sonner";
import { updateOrgSettings } from "./server-functions/settings";

const REQUIREMENT_OPTIONS = [
  { value: "guest", label: "Guest" },
  { value: "registered", label: "Registered" },
  { value: "card_on_file", label: "Card on File" },
];

interface Settings {
  bidderRequirement: string;
  stripeConnectAccountId: string | null;
}

export function AdminSettingsClient({
  initialSettings,
}: {
  initialSettings: Settings;
}) {
  const [bidderRequirement, setBidderRequirement] = useState(
    initialSettings.bidderRequirement,
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function handleSave() {
    setError("");
    startTransition(async () => {
      try {
        await updateOrgSettings({ bidderRequirement });
        toast.success("Settings saved");
      } catch (e: any) {
        setError(e.message);
      }
    });
  }

  const isConnected = !!initialSettings.stripeConnectAccountId;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Organization Settings</h1>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Bidder Requirement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bidder-requirement">
              Default requirement for bidders
            </Label>
            <Select
              value={bidderRequirement}
              onValueChange={setBidderRequirement}
            >
              <SelectTrigger id="bidder-requirement" className="w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REQUIREMENT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Stripe Connect</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Status:</span>
            {isConnected ? (
              <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                Connected
              </Badge>
            ) : (
              <Badge variant="secondary">Not Connected</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="mt-4">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
