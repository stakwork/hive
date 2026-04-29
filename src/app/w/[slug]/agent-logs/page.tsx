"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams, usePathname } from "next/navigation";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentLogsTable } from "@/components/agent-logs";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { AgentLogRecord, AgentLogsResponse } from "@/types/agent-logs";
import type { ConversationListItem } from "@/types/shared-conversation";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const slug = params.slug as string;
  const { workspace, id: workspaceId } = useWorkspace();

  const [activeTab, setActiveTab] = useState<"agents" | "chats">(
    (searchParams?.get("tab") as "agents" | "chats") ?? "agents"
  );

  const [logs, setLogs] = useState<AgentLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(() => parseInt(searchParams?.get("page") ?? "1", 10) || 1);
  const [hasMore, setHasMore] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Chats tab state
  const [chatLogs, setChatLogs] = useState<AgentLogRecord[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatPage, setChatPage] = useState(1);
  const [chatHasMore, setChatHasMore] = useState(false);

  // Mirror searchParams into a ref so goToPage can read the latest value
  // without listing searchParams as a reactive dep (which would cause a loop)
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);

  // Navigate to a specific page and update URL
  // NOTE: searchParams intentionally removed from deps — read via ref to avoid
  // a goToPage recreation loop (router.replace → new searchParams → goToPage
  // recreated → debounce effect fires → goToPage(1) → snaps back to page 1)
  const goToPage = useCallback((n: number) => {
    setPage(n);
    const params = new URLSearchParams(searchParamsRef.current?.toString() || "");
    if (n <= 1) {
      params.delete("page");
    } else {
      params.set("page", n.toString());
    }
    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [pathname, router]); // searchParams intentionally omitted — use ref above

  // Keep a ref to the latest goToPage to avoid it being a dep in the debounce effect
  const goToPageRef = useRef(goToPage);
  useEffect(() => {
    goToPageRef.current = goToPage;
  }); // no dep array — keeps ref current after every render

  // Track previous search keyword so we only reset page when it actually changes
  const prevSearchKeyword = useRef("");

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchKeyword);
      if (searchKeyword !== prevSearchKeyword.current) {
        goToPageRef.current(1); // only reset page when search actually changed
      }
      prevSearchKeyword.current = searchKeyword;
    }, 500);

    return () => clearTimeout(timer);
  }, [searchKeyword]); // goToPage intentionally omitted — accessed via ref

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

  // Fetch chats when chats tab is active
  useEffect(() => {
    if (activeTab !== "chats") return;
    if (!slug) return;

    const fetchChats = async () => {
      setChatLoading(true);
      setChatError(null);

      try {
        const response = await fetch(
          `/api/workspaces/${slug}/chat/conversations?page=${chatPage}&limit=20`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch chats");
        }

        const data: { items: ConversationListItem[]; pagination: { page: number; limit: number; total: number; totalPages: number } } = await response.json();

        const mapped: AgentLogRecord[] = data.items.map((conv) => ({
          id: conv.id,
          agent: "chat",
          blobUrl: "",
          createdAt: new Date(conv.lastMessageAt ?? conv.createdAt),
          featureTitle: conv.title,
          stakworkRunId: null,
          taskId: null,
        }));

        setChatLogs(mapped);
        setChatHasMore(chatPage < data.pagination.totalPages);
      } catch (err) {
        console.error("Error fetching chats:", err);
        setChatError(err instanceof Error ? err.message : "Failed to fetch chats");
      } finally {
        setChatLoading(false);
      }
    };

    fetchChats();
  }, [activeTab, slug, chatPage]);

  const handleTabChange = (value: string) => {
    const next = value === "chats" ? "chats" : "agents";
    setActiveTab(next);
    const params = new URLSearchParams(searchParamsRef.current?.toString() || "");
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleChatDownload = async (log: AgentLogRecord) => {
    try {
      const res = await fetch(
        `/api/workspaces/${slug}/chat/conversations/${log.id}`
      );
      if (!res.ok) throw new Error("Failed to fetch conversation");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chat-${log.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Chat download failed:", err);
    }
  };

  const handleRowClick = (logId: string) => {
    router.push(`/w/${slug}/agent-logs/${logId}`);
  };

  const handleChatRowClick = (convId: string) => {
    router.push(`/w/${slug}/agent-logs/chat/${convId}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader icon={FileText} title="Agent Logs" />
        {/* {(slug === "hive" || slug === "stakwork") && ( */}
          <Button asChild>
            <Link href={`/w/${slug}/agent-logs/chat`}>
              <MessageSquare className="w-4 h-4 mr-2" />
              Logs Chat
            </Link>
          </Button>
        {/* )} */}
      </div>

      <Card>
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <CardTitle>Execution Logs</CardTitle>
                <TabsList>
                  <TabsTrigger value="agents">Agents</TabsTrigger>
                  <TabsTrigger value="chats">Chats</TabsTrigger>
                </TabsList>
              </div>
              {activeTab === "agents" && (
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
                      goToPage(1);
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
              )}
            </div>
          </CardHeader>

        <CardContent>
          {activeTab === "agents" && loading && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                     <TableHead>Timestamp</TableHead>
                     <TableHead>Agent Name</TableHead>
                     <TableHead>Feature</TableHead>
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
                         <Skeleton className="h-5 w-28" />
                       </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {activeTab === "agents" && error && !loading && (
            <div className="text-center py-12">
              <p className="text-destructive mb-2">Error loading agent logs</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          )}

          {activeTab === "agents" && !loading && !error && (
            <AgentLogsTable logs={logs} onRowClick={handleRowClick} />
          )}

          {activeTab === "agents" && !loading && !error && logs.length > 0 && (
            <div className="mt-6">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <Button
                      variant="ghost"
                      size="default"
                      onClick={() => goToPage(Math.max(1, page - 1))}
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
                        onClick={() => goToPage(1)}
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
                          onClick={() => goToPage(page + 1)}
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

          {activeTab === "chats" && chatLoading && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Agent Name</TableHead>
                    <TableHead>Feature</TableHead>
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
                        <Skeleton className="h-5 w-28" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {activeTab === "chats" && chatError && !chatLoading && (
            <div className="text-center py-12">
              <p className="text-destructive mb-2">Error loading chats</p>
              <p className="text-sm text-muted-foreground">{chatError}</p>
            </div>
          )}

          {activeTab === "chats" && !chatLoading && !chatError && (
            <AgentLogsTable
              logs={chatLogs}
              onRowClick={handleChatRowClick}
              onDownload={handleChatDownload}
            />
          )}

          {activeTab === "chats" && !chatLoading && !chatError && chatLogs.length > 0 && (
            <div className="mt-6">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <Button
                      variant="ghost"
                      size="default"
                      onClick={() => setChatPage(Math.max(1, chatPage - 1))}
                      disabled={chatPage === 1}
                      className="gap-1 pl-2.5"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span>Previous</span>
                    </Button>
                  </PaginationItem>

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
                      {chatPage}
                    </Button>
                  </PaginationItem>

                  {chatHasMore && (
                    <PaginationItem>
                      <Button
                        variant="ghost"
                        size="default"
                        onClick={() => setChatPage(chatPage + 1)}
                        className="gap-1 pr-2.5"
                      >
                        <span>Next</span>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </PaginationItem>
                  )}
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
        </Tabs>
      </Card>

    </div>
  );
}
