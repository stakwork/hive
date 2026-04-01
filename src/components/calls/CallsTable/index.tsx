"use client";

import React from "react";
import Link from "next/link";
import { CallRecording } from "@/types/calls";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface CallsTableProps {
  calls: CallRecording[];
  workspaceSlug: string;
}

export function CallsTable({ calls, workspaceSlug }: CallsTableProps) {
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  if (calls.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="font-medium">No valid call recordings found</p>
        <p className="text-sm mt-2">Some recordings may have incomplete data and were filtered out</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Date Added</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {calls.map((call) => (
            <TableRow
              key={call.ref_id}
              className="relative cursor-pointer hover:bg-muted/50"
            >
              <TableCell className="font-medium">
                <Link
                  href={`/w/${workspaceSlug}/calls/${call.ref_id}`}
                  className="absolute inset-0"
                  aria-label={call.episode_title}
                />
                {call.episode_title}
              </TableCell>
              <TableCell>{formatDate(call.date_added_to_graph)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
