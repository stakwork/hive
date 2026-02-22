"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AgentLogRecord } from "@/types/agent-logs";

interface AgentLogsTableProps {
  logs: AgentLogRecord[];
  onRowClick: (logId: string) => void;
}

const formatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function AgentLogsTable({ logs, onRowClick }: AgentLogsTableProps) {
  if (logs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium">No agent logs found</p>
        <p className="text-sm mt-2">
          Agent logs will appear here after workflows are executed
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Timestamp</TableHead>
            <TableHead>Agent Name</TableHead>
            <TableHead>Task/Run ID</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <TableRow
              key={log.id}
              onClick={() => onRowClick(log.id)}
              className="cursor-pointer hover:bg-muted/50"
            >
              <TableCell>
                {formatter.format(new Date(log.createdAt))}
              </TableCell>
              <TableCell className="font-medium">{log.agent}</TableCell>
              <TableCell className="text-muted-foreground">
                {log.taskId || log.stakworkRunId || "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
