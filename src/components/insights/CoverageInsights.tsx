"use client";

import { useUncoveredNodes } from "@/hooks/useUncoveredNodes";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useMemo } from "react";
import type { UncoveredNodeConcise } from "@/types/stakgraph";

export function CoverageInsights() {
  const { items, loading, error, page, setPage, setTests, params } = useUncoveredNodes({
    nodeType: "endpoint",
    tests: "all",
    limit: 10,
    concise: true,
  });

  const hasItems = items && items.length > 0;

  const rows = useMemo(
    () =>
      (items as UncoveredNodeConcise[]).map((item, idx) => ({
        key: `${idx}-${item.name}-${item.file}`,
        name: item.name,
        file: item.file,
        weight: item.weight,
      })),
    [items],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Endpoint Coverage</CardTitle>
            <CardDescription>List of uncovered endpoints from stakgraph</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Filter: Endpoints</Badge>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={params.tests}
              onChange={(e) => setTests(e.target.value as "unit" | "integration" | "e2e" | "all")}
            >
              <option value="unit">Unit</option>
              <option value="integration">Integration</option>
              <option value="e2e">E2E</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading uncovered endpoints...
          </div>
        ) : error ? (
          <div className="text-sm text-red-600">{error}</div>
        ) : !hasItems ? (
          <div className="text-sm text-muted-foreground">No endpoints found with the selected filters.</div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">Name</TableHead>
                    <TableHead className="w-[45%]">File</TableHead>
                    <TableHead className="w-[15%] text-right">Weight</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="truncate max-w-[320px]">{r.name}</TableCell>
                      <TableCell className="truncate max-w-[360px] text-muted-foreground">{r.file}</TableCell>
                      <TableCell className="text-right">{r.weight}</TableCell>
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
