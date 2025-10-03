"use client";

import { useCoverageNodes } from "@/hooks/useCoverageNodes";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { useMemo } from "react";
import type { CoverageNodeConcise } from "@/types/stakgraph";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CoverageSortOption } from "@/stores/useCoverageStore";

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
        className="flex items-center gap-1 hover:text-foreground transition-colors font-medium cursor-pointer select-none"
        type="button"
      >
        <span className={isActive ? "text-foreground" : ""}>{label}</span>
        {isActive ? (
          sortDirection === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 transition-transform" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 transition-transform" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-40 transition-opacity" />
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
    prefetchNext,
    prefetchPrev,
  } = useCoverageNodes();

  const hasItems = items && items.length > 0;

  const rows = useMemo(
    () =>
      (items as CoverageNodeConcise[]).map((item) => ({
        key: `${item.name}-${item.file}`,
        name: item.name,
        file: item.file,
        coverage: item.test_count,
        weight: item.weight,
        covered: (item.test_count || 0) > 0,
        bodyLength: item.body_length,
        lineCount: item.line_count,
      })),
    [items],
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

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Type:</span>
              <Tabs value={params.nodeType} onValueChange={(v) => setNodeType(v as "endpoint" | "function")}>
                <TabsList className="h-8">
                  <TabsTrigger value="endpoint" className="text-xs px-3">Endpoints</TabsTrigger>
                  <TabsTrigger value="function" className="text-xs px-3">Functions</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Status:</span>
              <Select value={params.coverage} onValueChange={(v) => setCoverage(v as "all" | "tested" | "untested")}>
                <SelectTrigger className="h-8 w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">All</SelectItem>
                  <SelectItem value="tested" className="text-xs">Tested</SelectItem>
                  <SelectItem value="untested" className="text-xs">Untested</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between pb-2">
          <CardTitle>{params.nodeType === "endpoint" ? "Endpoints" : "Functions"}</CardTitle>
          {filterLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Filtering...
            </div>
          )}
        </div>
        {loading && !filterLoading ? (
          <div className="space-y-3">
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader
                      label="Name"
                      sortKey="name"
                      currentSort={params.sort}
                      sortDirection={params.sortDirection}
                      onSort={toggleSort}
                      className="w-[25%]"
                    />
                    <TableHead className="w-[30%]">File</TableHead>
                    <SortableHeader
                      label="Coverage"
                      sortKey="test_count"
                      currentSort={params.sort}
                      sortDirection={params.sortDirection}
                      onSort={toggleSort}
                      className="w-[10%] text-right"
                    />
                    <SortableHeader
                      label="Body Length"
                      sortKey="body_length"
                      currentSort={params.sort}
                      sortDirection={params.sortDirection}
                      onSort={toggleSort}
                      className="w-[12%] text-right"
                    />
                    <SortableHeader
                      label="Line Count"
                      sortKey="line_count"
                      currentSort={params.sort}
                      sortDirection={params.sortDirection}
                      onSort={toggleSort}
                      className="w-[10%] text-right"
                    />
                    <TableHead className="w-[13%] text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-4 w-32" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-48" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Skeleton className="h-4 w-8 ml-auto" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Skeleton className="h-4 w-12 ml-auto" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Skeleton className="h-4 w-8 ml-auto" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Skeleton className="h-5 w-16 ml-auto" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : error ? (
          <div className="text-sm text-red-600">{error}</div>
        ) : !hasItems ? (
          <div className="text-sm text-muted-foreground">No nodes found with the selected filters.</div>
        ) : (
          <div className="space-y-3">
            <div
              className={`rounded-md border overflow-hidden transition-opacity ${filterLoading ? "opacity-50" : "opacity-100"}`}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader
                      label="Name"
                      sortKey="name"
                      currentSort={params.sort}
                      sortDirection={params.sortDirection}
                      onSort={toggleSort}
                      className="w-[25%]"
                    />
                    <TableHead className="w-[30%]">File</TableHead>
                    <SortableHeader
                      label="Coverage"
                      sortKey="test_count"
                      currentSort={params.sort}
                      sortDirection={params.sortDirection}
                      onSort={toggleSort}
                      className="w-[10%] text-right"
                    />
                    <SortableHeader
                      label="Body Length"
                      sortKey="body_length"
                      currentSort={params.sort}
                      sortDirection={params.sortDirection}
                      onSort={toggleSort}
                      className="w-[12%] text-right"
                    />
                    <SortableHeader
                      label="Line Count"
                      sortKey="line_count"
                      currentSort={params.sort}
                      sortDirection={params.sortDirection}
                      onSort={toggleSort}
                      className="w-[10%] text-right"
                    />
                    <TableHead className="w-[13%] text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={`${r.name}-${r.file}-${params.offset}-${i}`} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="truncate max-w-[280px] font-mono text-sm">{r.name}</TableCell>
                      <TableCell className="truncate max-w-[320px] text-muted-foreground text-xs">{r.file}</TableCell>
                      <TableCell className="text-right font-medium">{r.coverage}</TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {r.bodyLength != null ? r.bodyLength.toLocaleString() : "-"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {r.lineCount != null ? r.lineCount.toLocaleString() : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={r.covered ? "default" : "outline"}>{r.covered ? "Tested" : "Untested"}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between">
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
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={!hasNextPage || filterLoading}
                  onMouseEnter={() => hasNextPage && prefetchNext()}
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
