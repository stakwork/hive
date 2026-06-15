"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Download } from "lucide-react";
import type { AgentLogRecord } from "@/types/agent-logs";

interface AgentLogsTableProps {
  logs: AgentLogRecord[];
  onRowClick: (logId: string) => void;
  onDownload?: (log: AgentLogRecord) => Promise<void>;
  showUserColumn?: boolean;
}

const formatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function AgentLogsTable({ logs, onRowClick, onDownload, showUserColumn = false }: AgentLogsTableProps) {
  const handleDownload = async (logId: string, agent: string) => {
    try {
      const res = await fetch(`/api/agent-logs/${logId}/content`);
      if (!res.ok) throw new Error("Failed to fetch log content");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${agent}-${logId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

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
            {showUserColumn && <TableHead>User</TableHead>}
            <TableHead>Agent Name</TableHead>
            <TableHead>Feature</TableHead>
            <TableHead className="w-10" />
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
              {showUserColumn && (
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={log.initiatorImage ?? undefined} />
                      <AvatarFallback className="text-xs">
                        {getInitials(log.initiatorName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-muted-foreground">
                      {log.initiatorName ?? "Anonymous"}
                    </span>
                  </div>
                </TableCell>
              )}
              <TableCell className="font-medium">{log.agent}</TableCell>
              <TableCell className="text-muted-foreground">
                {log.featureTitle
                  ? log.featureTitle.length > 20
                    ? `${log.featureTitle.slice(0, 20)}...`
                    : log.featureTitle
                  : "-"}
              </TableCell>
              <TableCell>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onDownload) {
                      onDownload(log);
                    } else {
                      handleDownload(log.id, log.agent);
                    }
                  }}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  title="Download log"
                >
                  <Download className="h-4 w-4" />
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
