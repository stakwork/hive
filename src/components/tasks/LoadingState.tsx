"use client";

import {
  Card,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function LoadingState() {
  return (
    <Card data-testid="tasks-loading-state">
      <CardHeader>
        <CardTitle>Loading tasks...</CardTitle>
      </CardHeader>
    </Card>
  );
}
