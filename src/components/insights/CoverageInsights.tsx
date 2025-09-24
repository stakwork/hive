"use client";

import { useCoverageNodes } from "@/hooks/useCoverageNodes";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { useMemo } from "react";
import type { CoverageNodeConcise, UncoveredNodeType } from "@/types/stakgraph";
import type { StatusFilter } from "@/hooks/useCoverageNodes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function CoverageInsights() {
  const { items, loading, error, page, setPage, params, setNodeType, setStatus } = useCoverageNodes({
    nodeType: "endpoint",
    limit: 10,
    concise: true,
    status: "all",
  });

  const hasItems = items && items.length > 0;

  const rows = useMemo(
    () =>
      (items as CoverageNodeConcise[]).map((item) => ({
        key: `${item.name}-${item.file}`,
        name: item.name,
        file: item.file,
        coverage: item.test_count,
        weight: item.weight,
        covered: item.covered,
      })),
    [items],
  );

  const setNodeTypeFilter = (value: UncoveredNodeType) => setNodeType(value);
  const setStatusFilter = (value: StatusFilter) => setStatus(value);

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
              <DropdownMenuItem onClick={() => setNodeTypeFilter("endpoint")}>
                {params.nodeType === "endpoint" && <span className="text-green-500">•</span>} Endpoint
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setNodeTypeFilter("function")}>
                {params.nodeType === "function" && <span className="text-green-500">•</span>} Function
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Status</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setStatusFilter("tested")}>
                {params.status === "tested" && <span className="text-green-500">•</span>} Tested
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter("untested")}>
                {params.status === "untested" && <span className="text-green-500">•</span>} Untested
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter("all")}>
                {params.status === "all" && <span className="text-green-500">•</span>} All
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        <CardTitle className="pb-2">{params.nodeType === "endpoint" ? "Endpoints" : "Functions"}</CardTitle>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading nodes...
          </div>
        ) : error ? (
          <div className="text-sm text-red-600">{error}</div>
        ) : !hasItems ? (
          <div className="text-sm text-muted-foreground">No nodes found with the selected filters.</div>
        ) : (
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
                  {rows.map((r) => (
                    <TableRow key={r.key}>
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
              <div className="text-xs text-muted-foreground">Page {page}</div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPage(page + 1)}>
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
