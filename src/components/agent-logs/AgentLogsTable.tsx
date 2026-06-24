"use client";

import { useState, useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Download, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgentLogRecord } from "@/types/agent-logs";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { PUSHER_EVENTS } from "@/lib/pusher";
import { TraceViewerModal } from "./TraceViewerModal";

interface AgentTraceReadyPayload {
  agentLogId: string;
  traceStatus: "pending" | "ready" | "error";
  phoenixTraceUrl: string;
}

interface AgentLogsTableProps {
  logs: AgentLogRecord[];
  onRowClick: (logId: string) => void;
  onDownload?: (log: AgentLogRecord) => Promise<void>;
  showUserColumn?: boolean;
  slug?: string;
  pusherChannelName?: string;
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

export function AgentLogsTable({
  logs: initialLogs,
  onRowClick,
  onDownload,
  showUserColumn = false,
  slug,
  pusherChannelName,
}: AgentLogsTableProps) {
  const [logs, setLogs] = useState<AgentLogRecord[]>(initialLogs);
  const [traceLog, setTraceLog] = useState<AgentLogRecord | null>(null);

  // Sync when parent passes updated logs
  useEffect(() => {
    setLogs(initialLogs);
  }, [initialLogs]);

  // Pusher subscription for real-time trace status updates
  const channel = usePusherChannel(pusherChannelName ?? null);

  useEffect(() => {
    if (!channel) return;
    const handler = ({ agentLogId, traceStatus, phoenixTraceUrl }: AgentTraceReadyPayload) => {
      setLogs((prev) =>
        prev.map((l) =>
          l.id === agentLogId ? { ...l, traceStatus, phoenixTraceUrl } : l
        )
      );
    };
    channel.bind(PUSHER_EVENTS.AGENT_TRACE_READY, handler);
    return () => { channel.unbind(PUSHER_EVENTS.AGENT_TRACE_READY, handler); };
  }, [channel]);

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

  const handleGenerateTrace = async (e: React.MouseEvent, log: AgentLogRecord) => {
    e.stopPropagation();
    if (!slug) return;

    // Optimistic update
    setLogs((prev) =>
      prev.map((l) => (l.id === log.id ? { ...l, traceStatus: "pending" } : l))
    );

    try {
      const res = await fetch(
        `/api/workspaces/${slug}/agent-logs/${log.id}/generate-trace`,
        { method: "POST" }
      );
      if (!res.ok) {
        // Revert on failure
        setLogs((prev) =>
          prev.map((l) => (l.id === log.id ? { ...l, traceStatus: null } : l))
        );
      }
    } catch (err) {
      console.error("Generate trace failed:", err);
      setLogs((prev) =>
        prev.map((l) => (l.id === log.id ? { ...l, traceStatus: null } : l))
      );
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
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              {showUserColumn && <TableHead>User</TableHead>}
              <TableHead>Agent Name</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Feature</TableHead>
              <TableHead className="w-10" />
              {slug && <TableHead>Trace</TableHead>}
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
                <TableCell>
                  {log.model
                    ? <Badge variant="secondary" className="text-xs font-mono">{log.model}</Badge>
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>
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
                {slug && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {!log.traceStatus && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={(e) => handleGenerateTrace(e, log)}
                      >
                        Generate Trace
                      </Button>
                    )}
                    {log.traceStatus === "pending" && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Generating…
                      </span>
                    )}
                    {log.traceStatus === "ready" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTraceLog(log);
                        }}
                      >
                        View Trace →
                      </Button>
                    )}
                    {log.traceStatus === "error" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs text-destructive border-destructive hover:bg-destructive/10"
                        onClick={(e) => handleGenerateTrace(e, log)}
                      >
                        Retry
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <TraceViewerModal
        open={!!traceLog}
        log={traceLog}
        onOpenChange={(open) => {
          if (!open) setTraceLog(null);
        }}
      />
    </>
  );
}
