"use client";

import { useRouter } from "next/navigation";
import { CallRecording } from "@/types/calls";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface CallsTableProps {
  calls: CallRecording[];
  workspaceSlug: string;
}

export function CallsTable({ calls, workspaceSlug }: CallsTableProps) {
  const router = useRouter();

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

  const handleRowClick = (refId: string) => {
    router.push(`/w/${workspaceSlug}/calls/${refId}`);
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
              onClick={() => handleRowClick(call.ref_id)}
              className="cursor-pointer hover:bg-muted/50"
            >
              <TableCell className="font-medium">{call.episode_title}</TableCell>
              <TableCell>{formatDate(call.date_added_to_graph)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
