"use client";

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
}

export function CallsTable({ calls }: CallsTableProps) {
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
        <p>No call recordings found</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Date Added</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {calls.map((call) => (
            <TableRow key={call.ref_id}>
              <TableCell className="font-medium">
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
