"use client";

import { useCoverageNodes } from "@/hooks/useCoverageNodes";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowUpDown, ArrowUp, ArrowDown, Search } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import type { CoverageNodeConcise } from "@/types/stakgraph";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CoverageSortOption } from "@/stores/useCoverageStore";
import { formatNumber } from "@/lib/utils/format";
import { AdvancedFiltersPopover } from "./AdvancedFiltersPopover";

interface SortableHeaderProps {
  label: string;
  sortKey: CoverageSortOption;
  currentSort: CoverageSortOption;
  sortDirection: "asc" | "desc";
  onSort: (key: CoverageSortOption) => void;
  className?: string;
}

function SortableHeader({ label, sortKey, currentSort, sortDirection, onSort, className }: SortableHeaderProps) {
  const isActive = currentSort === sortKey;

  return (
    <TableHead className={className}>
      <button
        onClick={() => onSort(sortKey)}
        className="flex items-center gap-1.5 hover:text-foreground transition-colors font-medium cursor-pointer select-none -mx-2 px-2 py-1 rounded hover:bg-muted/50 w-full"
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

export function CoverageInsights() {
  const {
    items,
    loading,
    filterLoading,
    error,
    page,
    totalPages,
    totalCount,
    totalReturned,
    hasNextPage,
    hasPrevPage,
    setPage,
    params,
    setNodeType,
    toggleSort,
    setCoverage,
    setMocked,
    mocked,
    prefetchNext,
    prefetchPrev,
  } = useCoverageNodes();

  const {
    ignoreDirs,
    setIgnoreDirs,
    repo,
    setRepo,
    unitGlob,
    setUnitGlob,
    integrationGlob,
    setIntegrationGlob,
    e2eGlob,
    setE2eGlob,
    search,
    setSearch,
  } = useCoverageNodes();

  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, setSearch]);

  const hasItems = items && items.length > 0;

  const rows = useMemo(
    () =>
      (items as CoverageNodeConcise[]).map((item) => {
        const displayName = item.verb && params.nodeType === "endpoint" ? `${item.verb} ${item.name}` : item.name;
        return {
          key: `${item.name}-${item.file}`,
          name: displayName,
          file: item.file,
          coverage: item.test_count,
          weight: item.weight,
          covered: (item.test_count || 0) > 0,
          bodyLength: item.body_length,
          lineCount: item.line_count,
        };
      }),
    [items, params.nodeType],
  );

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="space-y-4">
          <div>
            <CardTitle className="text-base">Test Coverage Insights</CardTitle>
            <CardDescription>
              Nodes with coverage degree (number of tests that cover the node). Filter untested to focus gaps.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Type:</span>
              <Select
                value={params.nodeType}
                onValueChange={(v) => setNodeType(v as "endpoint" | "function" | "class" | "mock")}
              >
                <SelectTrigger className="h-8 w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="endpoint" className="text-xs">
                    Endpoints
                  </SelectItem>
                  <SelectItem value="function" className="text-xs">
                    Functions
                  </SelectItem>
                  <SelectItem value="class" className="text-xs">
                    Classes
                  </SelectItem>
                  <SelectItem value="mock" className="text-xs">
                    Mocks
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">
                {params.nodeType === "mock" ? "Mocked:" : "Status:"}
              </span>
              {params.nodeType === "mock" ? (
                <Select value={mocked} onValueChange={(v) => setMocked(v as "all" | "mocked" | "unmocked")}>
                  <SelectTrigger className="h-8 w-[120px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">
                      All
                    </SelectItem>
                    <SelectItem value="mocked" className="text-xs">
                      Mocked
                    </SelectItem>
                    <SelectItem value="unmocked" className="text-xs">
                      Unmocked
                    </SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Select value={params.coverage} onValueChange={(v) => setCoverage(v as "all" | "tested" | "untested")}>
                  <SelectTrigger className="h-8 w-[120px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">
                      All
                    </SelectItem>
                    <SelectItem value="tested" className="text-xs">
                      Tested
                    </SelectItem>
                    <SelectItem value="untested" className="text-xs">
                      Untested
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search nodes..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-8 w-[200px] pl-8 text-xs"
              />
            </div>

            {params.nodeType !== "mock" && (
              <AdvancedFiltersPopover
                ignoreDirs={ignoreDirs}
                setIgnoreDirs={setIgnoreDirs}
                repo={repo}
                setRepo={setRepo}
                unitGlob={unitGlob}
                setUnitGlob={setUnitGlob}
                integrationGlob={integrationGlob}
                setIntegrationGlob={setIntegrationGlob}
                e2eGlob={e2eGlob}
                setE2eGlob={setE2eGlob}
              />
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between pb-2">
          <CardTitle>
            {params.nodeType === "endpoint"
              ? "Endpoints"
              : params.nodeType === "function"
                ? "Functions"
                : params.nodeType === "class"
                  ? "Classes"
                  : "Mock Services"}
          </CardTitle>
          {filterLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Filtering...
            </div>
          )}
        </div>
        {error ? (
          <div className="text-sm text-red-600">{error}</div>
        ) : !hasItems && !loading && !filterLoading ? (
          <div className="text-sm text-muted-foreground">No nodes found with the selected filters.</div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <SortableHeader
                      label="Name"
                      sortKey="name"
                      currentSort={params.sort}
                      sortDirection={params.sortDirection}
                      onSort={toggleSort}
                      className="w-[30%]"
                    />
                    <TableHead className="w-[40%]">File</TableHead>
                    <SortableHeader
                      label="Coverage"
                      sortKey="test_count"
                      currentSort={params.sort}
                      sortDirection={params.sortDirection}
                      onSort={toggleSort}
                      className="w-[12%] text-right"
                    />
                    <SortableHeader
                      label="Lines"
                      sortKey="line_count"
                      currentSort={params.sort}
                      sortDirection={params.sortDirection}
                      onSort={toggleSort}
                      className="w-[10%] text-right"
                    />
                    <TableHead className="w-[8%] text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading || filterLoading
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={`skeleton-${i}`} className="animate-in fade-in duration-200">
                          <TableCell className="w-[30%]">
                            <Skeleton className="h-4 w-full max-w-[200px]" />
                          </TableCell>
                          <TableCell className="w-[40%]">
                            <Skeleton className="h-4 w-full max-w-[300px]" />
                          </TableCell>
                          <TableCell className="text-right w-[12%]">
                            <Skeleton className="h-4 w-12 ml-auto" />
                          </TableCell>
                          <TableCell className="text-right w-[10%]">
                            <Skeleton className="h-4 w-12 ml-auto" />
                          </TableCell>
                          <TableCell className="text-right">
                            <Skeleton className="h-5 w-16 ml-auto" />
                          </TableCell>
                        </TableRow>
                      ))
                    : rows.map((r, i) => (
                        <TableRow
                          key={`${r.name}-${r.file}-${params.offset}-${i}`}
                          className="hover:bg-muted/50 transition-all duration-200"
                          style={{ animationDelay: `${i * 25}ms` }}
                        >
                          <TableCell className="truncate max-w-[320px] font-mono text-sm" title={r.name}>
                            {r.name}
                          </TableCell>
                          <TableCell className="truncate max-w-[400px] text-muted-foreground text-xs" title={r.file}>
                            {r.file}
                          </TableCell>
                          <TableCell
                            className="text-right font-medium tabular-nums"
                            title={`${formatNumber(r.coverage)} test${r.coverage !== 1 ? "s" : ""}`}
                          >
                            {formatNumber(r.coverage)}
                          </TableCell>
                          <TableCell
                            className="text-right text-muted-foreground tabular-nums text-sm"
                            title={r.lineCount != null ? `${formatNumber(r.lineCount)} lines` : "N/A"}
                          >
                            {r.lineCount != null ? formatNumber(r.lineCount) : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={r.covered ? "default" : "outline"}>
                              {r.covered ? "Tested" : "Untested"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="text-xs text-muted-foreground">
                Page {page}
                {totalPages ? ` of ${totalPages}` : ""}
                {typeof totalCount === "number" && typeof totalReturned === "number" ? (
                  <>
                    {" "}
                    &middot; Showing {totalReturned} of {totalCount} nodes
                  </>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={!hasPrevPage || filterLoading}
                  onMouseEnter={() => hasPrevPage && prefetchPrev()}
                  className="min-w-20"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={!hasNextPage || filterLoading}
                  onMouseEnter={() => hasNextPage && prefetchNext()}
                  className="min-w-20"
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
