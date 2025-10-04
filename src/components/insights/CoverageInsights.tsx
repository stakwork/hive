"use client";

import { useCoverageNodes } from "@/hooks/useCoverageNodes";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { useMemo } from "react";
import type { CoverageNodeConcise } from "@/types/stakgraph";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CoverageSortOption } from "@/stores/useCoverageStore";

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
    setSort,
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
      })),
    [items],
  );

  const setSortFilter = (value: CoverageSortOption) => setSort(value);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Test Coverage Insights</CardTitle>
            <CardDescription>
              Nodes with coverage degree (number of tests that cover the node). Filter untested to focus gaps.
            </CardDescription>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <SlidersHorizontal className="h-4 w-4" /> Filters
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Node Type</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setNodeType("endpoint")}>
                {params.nodeType === "endpoint" && <span className="text-green-500">•</span>} Endpoint
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setNodeType("function")}>
                {params.nodeType === "function" && <span className="text-green-500">•</span>} Function
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Test Status</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setCoverage("all")}>
                {params.coverage === "all" && <span className="text-green-500">•</span>} All
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCoverage("tested")}>
                {params.coverage === "tested" && <span className="text-green-500">•</span>} Tested
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCoverage("untested")}>
                {params.coverage === "untested" && <span className="text-green-500">•</span>} Untested
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Sort</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setSortFilter("test_count")}>
                {params.sort === "test_count" && <span className="text-green-500">• </span>}By test count
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortFilter("body_length")}>
                {params.sort === "body_length" && <span className="text-green-500">• </span>}By body length
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortFilter("line_count")}>
                {params.sort === "line_count" && <span className="text-green-500">• </span>}By line count
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortFilter("name")}>
                {params.sort === "name" && <span className="text-green-500">• </span>}By name
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
                    <TableHead className="w-[35%]">Name</TableHead>
                    <TableHead className="w-[40%]">File</TableHead>
                    <TableHead className="w-[10%] text-right">Coverage</TableHead>
                    <TableHead className="w-[15%] text-right">Status</TableHead>
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
                    <TableHead className="w-[35%]">Name</TableHead>
                    <TableHead className="w-[40%]">File</TableHead>
                    <TableHead className="w-[10%] text-right">Coverage</TableHead>
                    <TableHead className="w-[15%] text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={`${r.name}-${r.file}-${params.offset}-${i}`}>
                      <TableCell className="truncate max-w-[320px]">{r.name}</TableCell>
                      <TableCell className="truncate max-w-[360px] text-muted-foreground">{r.file}</TableCell>
                      <TableCell className="text-right">{r.coverage}</TableCell>
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
