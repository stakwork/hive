"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { AgentLogsTable } from "@/components/agent-logs";
import { LogDetailDialog } from "@/components/agent-logs/LogDetailDialog";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { AgentLogRecord, AgentLogsResponse } from "@/types/agent-logs";
import { FileText, Search, ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";

const LOGS_PER_PAGE = 20;

type TimeRange = "24h" | "7d" | "30d" | "all";

function calculateDateRange(range: TimeRange): { start?: string; end?: string } {
  const now = new Date();
  const end = now.toISOString();

  switch (range) {
    case "24h":
      return {
        start: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        end,
      };
    case "7d":
      return {
        start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        end,
      };
    case "30d":
      return {
        start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        end,
      };
    case "all":
    default:
      return {};
  }
}

export default function AgentLogsPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { workspace, id: workspaceId } = useWorkspace();

  const [logs, setLogs] = useState<AgentLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchKeyword);
      setPage(1); // Reset to first page on search
    }, 500);

    return () => clearTimeout(timer);
  }, [searchKeyword]);

  // Fetch logs
  useEffect(() => {
    if (!workspaceId) return;

    const fetchLogs = async () => {
      setLoading(true);
      setError(null);

      try {
        const dateRange = calculateDateRange(timeRange);
        const skip = (page - 1) * LOGS_PER_PAGE;

        const params = new URLSearchParams({
          workspace_id: workspaceId,
          limit: LOGS_PER_PAGE.toString(),
          skip: skip.toString(),
        });

        if (dateRange.start) params.append("start_date", dateRange.start);
        if (dateRange.end) params.append("end_date", dateRange.end);
        if (debouncedSearch) params.append("search", debouncedSearch);

        const response = await fetch(`/api/agent-logs?${params.toString()}`);

        if (!response.ok) {
          throw new Error("Failed to fetch agent logs");
        }

        const data: AgentLogsResponse = await response.json();
        setLogs(data.data);
        setHasMore(data.hasMore);
      } catch (err) {
        console.error("Error fetching agent logs:", err);
        setError(
          err instanceof Error ? err.message : "Failed to fetch agent logs"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, [workspaceId, page, timeRange, debouncedSearch]);

  const handleRowClick = (logId: string) => {
    setSelectedLogId(logId);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader icon={FileText} title="Agent Logs" />
        {(slug === "hive" || slug === "stakwork") && (
          <Button asChild>
            <Link href={`/w/${slug}/agent-logs/chat`}>
              <MessageSquare className="w-4 h-4 mr-2" />
              Logs Chat
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Execution Logs</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search logs..."
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select
                value={timeRange}
                onValueChange={(value) => {
                  setTimeRange(value as TimeRange);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Last 24 hours</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading && (
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
                  {[1, 2, 3, 4, 5].map((i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-5 w-48" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-32" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-40" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {error && !loading && (
            <div className="text-center py-12">
              <p className="text-destructive mb-2">Error loading agent logs</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          )}

          {!loading && !error && (
            <AgentLogsTable logs={logs} onRowClick={handleRowClick} />
          )}

          {!loading && !error && logs.length > 0 && (
            <div className="mt-6">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <Button
                      variant="ghost"
                      size="default"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="gap-1 pl-2.5"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span>Previous</span>
                    </Button>
                  </PaginationItem>

                  {page > 1 && (
                    <PaginationItem>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setPage(1)}
                        className={buttonVariants({
                          variant: "ghost",
                          size: "icon",
                        })}
                      >
                        1
                      </Button>
                    </PaginationItem>
                  )}

                  {page > 2 && (
                    <PaginationItem>
                      <PaginationEllipsis />
                    </PaginationItem>
                  )}

                  <PaginationItem>
                    <Button
                      variant="outline"
                      size="icon"
                      className={buttonVariants({
                        variant: "outline",
                        size: "icon",
                      })}
                      disabled
                    >
                      {page}
                    </Button>
                  </PaginationItem>

                  {hasMore && (
                    <>
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                      <PaginationItem>
                        <Button
                          variant="ghost"
                          size="default"
                          onClick={() => setPage((p) => p + 1)}
                          className="gap-1 pr-2.5"
                        >
                          <span>Next</span>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </PaginationItem>
                    </>
                  )}
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>

      <LogDetailDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        logId={selectedLogId}
      />
    </div>
  );
}
