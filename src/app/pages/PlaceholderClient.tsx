"use client";

import { Card, CardContent } from "@/app/components/ui/card";

export function PlaceholderClient() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-lg font-medium text-muted-foreground">
            Coming Soon
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
