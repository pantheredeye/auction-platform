"use client";

import { useState, useEffect } from "react";
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
import { updateOrgSettings, updateTestMode } from "./server-functions/settings";
import {
  startConnectOnboarding,
  refreshConnectStatus,
  disconnectStripeConnect,
} from "@/stripe/server-functions/connect";

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
  stripeChargesEnabled: number;
  stripeConfigured: boolean;
  testMode: number;
}

export function AdminSettingsClient({
  initialSettings,
}: {
  initialSettings: Settings;
}) {
  const [bidderRequirement, setBidderRequirement] = useState(
    initialSettings.bidderRequirement,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [stripeState, setStripeState] = useState({
    connected: !!initialSettings.stripeConnectAccountId,
    chargesEnabled: !!initialSettings.stripeChargesEnabled,
    configured: initialSettings.stripeConfigured,
  });
  const [testModeEnabled, setTestModeEnabled] = useState(!!initialSettings.testMode);
  const [testModePending, setTestModePending] = useState(false);
  const [connectPending, setConnectPending] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("stripe") === "return") {
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
      // Sync status from Stripe
      refreshConnectStatus().then((result) => {
        setStripeState((prev) => ({
          ...prev,
          chargesEnabled: result.stripeChargesEnabled,
          connected: true,
        }));
        if (result.stripeChargesEnabled) {
          toast.success("Stripe Connect is active");
        } else {
          toast.info("Stripe onboarding incomplete — resume when ready");
        }
      });
    }
  }, []);

  async function handleSave() {
    setError("");
    setSaving(true);
    try {
      await updateOrgSettings({ bidderRequirement });
      toast.success("Settings saved");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestModeToggle() {
    const next = !testModeEnabled;
    setTestModePending(true);
    setError("");
    try {
      await updateTestMode(next);
      setTestModeEnabled(next);
      toast.success(next ? "Test mode enabled" : "Test mode disabled");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTestModePending(false);
    }
  }

  async function handleConnect() {
    setConnectPending(true);
    try {
      const { url } = await startConnectOnboarding();
      window.location.href = url;
    } catch (e: any) {
      setError(e.message);
      setConnectPending(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect Stripe account? This won't delete it from Stripe, but you'll need to reconnect to accept payments.")) {
      return;
    }
    setConnectPending(true);
    try {
      await disconnectStripeConnect();
      setStripeState({ connected: false, chargesEnabled: false, configured: true });
      toast.success("Stripe disconnected");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConnectPending(false);
    }
  }

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
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Bidder Requirement"}
          </Button>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Stripe Connect</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!stripeState.configured ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Payments not configured
              </span>
            </div>
          ) : !stripeState.connected ? (
            <div className="flex items-center gap-3">
              <Badge variant="secondary">Not Connected</Badge>
              <Button
                onClick={handleConnect}
                disabled={connectPending}
              >
                {connectPending ? "Redirecting..." : "Connect with Stripe"}
              </Button>
            </div>
          ) : stripeState.chargesEnabled ? (
            <div className="flex items-center gap-3">
              <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                Connected
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={connectPending}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="border-amber-500 text-amber-600">
                Onboarding Incomplete
              </Badge>
              <Button
                onClick={handleConnect}
                disabled={connectPending}
              >
                {connectPending ? "Redirecting..." : "Resume"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={connectPending}
              >
                Disconnect
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Test Mode</CardTitle>
          <p className="text-sm text-muted-foreground">
            Go live without Stripe Connect. Auctions created in test mode are
            clearly marked and won't process payments.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Badge
              className={
                testModeEnabled
                  ? "bg-amber-100 text-amber-700 hover:bg-amber-100"
                  : ""
              }
              variant={testModeEnabled ? "default" : "secondary"}
            >
              {testModeEnabled ? "Enabled" : "Disabled"}
            </Badge>
            <Button
              variant={testModeEnabled ? "outline" : "default"}
              size="sm"
              onClick={handleTestModeToggle}
              disabled={testModePending}
            >
              {testModePending
                ? "Saving..."
                : testModeEnabled
                  ? "Disable Test Mode"
                  : "Enable Test Mode"}
            </Button>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
