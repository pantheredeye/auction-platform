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
  {
    value: "guest",
    label: "Guest",
    description:
      "Anyone can bid with just a display name. Lowest friction, best for casual or charity auctions.",
  },
  {
    value: "registered",
    label: "Registered",
    description:
      "Bidders must provide their name and email before placing bids or chatting. Helps identify bidders and enables post-auction follow-up.",
  },
  {
    value: "card_on_file",
    label: "Card on File",
    description:
      "Bidders must save a payment card (or Apple Pay / Google Pay) via Stripe before bidding. Strongest deterrent against frivolous bids. Enables automated post-auction charges.",
  },
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
          <CardTitle>Default Bidder Requirement</CardTitle>
          <p className="text-sm text-muted-foreground">
            Controls what bidders must do before they can place bids or chat
            during your live auctions. Viewing is always open — this only gates
            participation. Individual auctions can override this default.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {REQUIREMENT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setBidderRequirement(opt.value)}
              className={`w-full text-left rounded-lg border-2 p-4 transition-colors ${
                bidderRequirement === opt.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/30"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium">{opt.label}</span>
                {bidderRequirement === opt.value && (
                  <Badge variant="secondary" className="text-xs">
                    Active
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {opt.description}
              </p>
            </button>
          ))}
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
