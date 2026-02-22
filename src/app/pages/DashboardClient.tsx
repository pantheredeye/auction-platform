"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Gavel, Clock, FileText, TrendingUp } from "lucide-react";

const summaryCards = [
  { label: "Active Auctions", value: "0", icon: Gavel },
  { label: "My Active Bids", value: "0", icon: Clock },
  { label: "Pending Invoices", value: "0", icon: FileText },
  { label: "Items Won", value: "0", icon: TrendingUp },
];

export function DashboardClient({
  user,
  currentOrganization,
}: {
  user: any;
  currentOrganization: any;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">
        Welcome, {user.displayName || user.username}
      </h1>
      <p className="text-muted-foreground mb-6">
        {currentOrganization?.name}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.label}
                </CardTitle>
                <Icon size={16} className="text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
