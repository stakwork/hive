"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export function LoadingState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Loading tasks...</CardTitle>
      </CardHeader>
    </Card>
  );
}
