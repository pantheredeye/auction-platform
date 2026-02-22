"use client";

import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Gavel } from "lucide-react";

export function LandingClient() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <Card className="p-8 text-center">
        <div className="flex justify-center mb-4">
          <Gavel size={48} className="text-primary" />
        </div>
        <h1 className="text-3xl font-bold mb-2">M&amp;M Auctions</h1>
        <p className="mb-6 text-muted-foreground">
          Live auctions, real-time bidding, great deals.
        </p>
        <Button asChild size="lg">
          <a href="/auth/login">Sign In</a>
        </Button>
      </Card>
    </div>
  );
}
