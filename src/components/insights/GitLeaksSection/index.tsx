"use client";

import { useState, useMemo } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, ArrowUpDown, ArrowUp, ArrowDown, ShieldAlert, CheckCircle2, ExternalLink } from "lucide-react";
import { GitLeakResult } from "@/types/git-leaks";
import { useToast } from "@/components/ui/use-toast";

type SortKey = "Date" | "File";
type SortDirection = "asc" | "desc";

interface SortableHeaderProps {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
  className?: string;
}

function SortableHeader({ label, sortKey, currentSort, sortDirection, onSort, className }: SortableHeaderProps) {
  const isActive = currentSort === sortKey;

  return (
    <TableHead className={className}>
      <button
        onClick={() => onSort(sortKey)}
        className="flex items-center gap-1.5 hover:text-foreground transition-colors font-medium cursor-pointer select-none -mx-2 px-2 py-1 rounded hover:bg-muted/50"
        type="button"
      >
        <span className={isActive ? "text-foreground" : ""}>{label}</span>
        {isActive ? (
          sortDirection === "asc" ? (
            <ArrowUp className="h-4 w-4 transition-transform shrink-0" />
          ) : (
            <ArrowDown className="h-4 w-4 transition-transform shrink-0" />
          )
        ) : (
          <ArrowUpDown className="h-4 w-4 opacity-30 group-hover:opacity-50 transition-opacity shrink-0" />
        )}
      </button>
    </TableHead>
  );
}

export function GitLeaksSection() {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const [leaks, setLeaks] = useState<GitLeakResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("Date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const ITEMS_PER_PAGE = 15;

  const handleRunScan = async () => {
    if (!workspace?.slug) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}/git-leaks`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to scan for git leaks");
      }

      setLeaks(data.leaks || []);
      setScannedAt(data.scannedAt);
      setPage(1);

      toast({
        title: "Scan completed",
        description: `Found ${data.count} potential secret${data.count !== 1 ? "s" : ""}`,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An error occurred";
      setError(errorMessage);
      toast({
        title: "Scan failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("desc");
    }
  };

  const sortedLeaks = useMemo(() => {
    if (!leaks.length) return [];

    const sorted = [...leaks].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortKey) {
        case "Date":
          aVal = new Date(a.Date).getTime();
          bVal = new Date(b.Date).getTime();
          break;
        case "File":
          aVal = a.File.toLowerCase();
          bVal = b.File.toLowerCase();
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [leaks, sortKey, sortDirection]);

  const paginatedLeaks = useMemo(() => {
    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return sortedLeaks.slice(startIndex, endIndex);
  }, [sortedLeaks, page]);

  const totalPages = Math.ceil(sortedLeaks.length / ITEMS_PER_PAGE);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateString;
    }
  };

  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "...";
  };

  const hasLeaks = leaks.length > 0;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              Secret Scanner
            </CardTitle>
            <CardDescription>
              Scan your repository for accidental secret leaks, API keys, and sensitive data.
            </CardDescription>
          </div>
          <Button onClick={handleRunScan} disabled={loading} size="sm">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Scanning...
              </>
            ) : (
              "Run Scan"
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="text-sm text-red-600 p-4 bg-red-50 rounded-md border border-red-200">{error}</div>
        ) : loading ? (
          <div className="space-y-3">
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-[15%]">Date</TableHead>
                    <TableHead className="w-[25%]">Description</TableHead>
                    <TableHead className="w-[35%]">Message</TableHead>
                    <TableHead className="w-[25%]">File</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`}>
                      <TableCell>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-full max-w-[200px]" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-full max-w-[250px]" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-full max-w-[150px]" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : !hasLeaks && scannedAt ? (
          <div className="text-center py-12 px-4">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
            <p className="text-base font-medium mb-1">No secrets detected</p>
            <p className="text-sm text-muted-foreground">
              Your repository appears to be clean of accidentally committed secrets.
            </p>
          </div>
        ) : !hasLeaks && !scannedAt ? (
          <div className="text-center py-12 px-4">
            <ShieldAlert className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Click &quot;Run Scan&quot; to check for secrets in your repository.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <SortableHeader
                      label="Date"
                      sortKey="Date"
                      currentSort={sortKey}
                      sortDirection={sortDirection}
                      onSort={toggleSort}
                      className="w-[15%]"
                    />
                    <TableHead className="w-[25%]">Description</TableHead>
                    <TableHead className="w-[35%]">Message</TableHead>
                    <SortableHeader
                      label="File"
                      sortKey="File"
                      currentSort={sortKey}
                      sortDirection={sortDirection}
                      onSort={toggleSort}
                      className="w-[25%]"
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedLeaks.map((leak, i) => (
                    <TableRow key={`${leak.Fingerprint}-${i}`} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="text-sm" title={leak.Date}>
                        {formatDate(leak.Date)}
                      </TableCell>
                      <TableCell className="text-sm" title={leak.Description}>
                        {truncateText(leak.Description, 50)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" title={leak.Message}>
                        {truncateText(leak.Message, 60)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground truncate" title={leak.File}>
                            {truncateText(leak.File, 40)}
                          </span>
                          {leak.Link && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => window.open(leak.Link, "_blank")}
                              className="h-6 w-6 p-0 shrink-0"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-1">
                <div className="text-xs text-muted-foreground">
                  Page {page} of {totalPages} &middot; Showing {paginatedLeaks.length} of {sortedLeaks.length} findings
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={!hasPrevPage}
                    className="min-w-20"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={!hasNextPage}
                    className="min-w-20"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
