"use client";

import React from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useActivity } from "@/hooks/useActivity";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "@/lib/utils/time";
import { RefreshCw, AlertCircle } from "lucide-react";


export default function ActivityPage() {
  const { slug } = useWorkspace();
  const { activities, loading, error, refetch } = useActivity(slug || "");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Activity</h1>
          <p className="text-muted-foreground mt-2">
            View recent activity and updates across your workspace.
          </p>
        </div>
        <Button
          onClick={refetch}
          disabled={loading}
          variant="outline"
          size="sm"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Error State */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-destructive" />
            <span className="text-destructive font-medium">Error loading activity</span>
          </div>
          <p className="text-muted-foreground text-sm mt-1">{error}</p>
        </div>
      )}

      {/* Recent Activity Table */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableCaption>
            {loading
              ? "Loading recent workspace activity..."
              : activities.length === 0
              ? "No recent activity found"
              : "Recent workspace activity"}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Activity</TableHead>
              <TableHead className="text-right">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              // Loading skeleton rows
              [...Array(3)].map((_, index) => (
                <TableRow key={`loading-${index}`}>
                  <TableCell>
                    <div className="h-4 bg-muted animate-pulse rounded w-3/4"></div>
                  </TableCell>
                  <TableCell>
                    <div className="h-4 bg-muted animate-pulse rounded w-20 ml-auto"></div>
                  </TableCell>
                </TableRow>
              ))
            ) : activities.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
                  No activity data available
                  <br />
                  <span className="text-sm">
                    Make sure your workspace has a configured swarm connection
                  </span>
                </TableCell>
              </TableRow>
            ) : (
              activities.map((activity) => (
                <TableRow key={activity.id}>
                  <TableCell className="font-medium">
                    {activity.summary}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDistanceToNow(activity.timestamp)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}