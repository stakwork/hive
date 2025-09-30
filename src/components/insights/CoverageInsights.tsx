"use client";

import { useCoverageNodes } from "@/hooks/useCoverageNodes";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useToast } from "@/components/ui/use-toast";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, SlidersHorizontal, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { CoverageNodeConcise } from "@/types/stakgraph";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

  const { slug } = useWorkspace();
  const { toast } = useToast();
  const router = useRouter();
  const [creatingTaskFor, setCreatingTaskFor] = useState<string | null>(null);

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

  const setSortFilter = (value: string) => setSort(value);

  const handleAddCoverage = async (functionName: string, functionFile: string) => {
    if (!slug) {
      toast({
        title: "Error",
        description: "Workspace not available",
        variant: "destructive",
      });
      return;
    }

    setCreatingTaskFor(functionName);

    try {
      const taskTitle = `Add test coverage for ${functionName}`;
      const taskDescription = `Can you add test coverage for this function ${functionName}?\n\nFunction: ${functionName}\nFile: ${functionFile}\n\nMake sure it passes and that it adds coverage to the project.`;

      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: taskTitle,
          description: taskDescription,
          workspaceSlug: slug,
          status: "TODO",
          priority: "MEDIUM",
          sourceType: "JANITOR",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create task");
      }

      const result = await response.json();
      const taskId = result.data.id;

      toast({
        title: "Task created",
        description: `Coverage task created for ${functionName}`,
      });

      // Redirect to the new task page
      router.push(`/w/${slug}/task/${taskId}`);
    } catch (error) {
      console.error("Error creating coverage task:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create task",
        variant: "destructive",
      });
    } finally {
      setCreatingTaskFor(null);
    }
  };

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
                {params.sort === "test_count" && <span className="text-green-500">•</span>} By test count
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortFilter("name")}>
                {params.sort === "name" && <span className="text-green-500">•</span>} By name
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
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-12 gap-4">
                    <div className="col-span-4 h-4 rounded-md bg-muted animate-pulse" />
                    <div className="col-span-5 h-4 rounded-md bg-muted animate-pulse" />
                    <div className="col-span-1 h-4 rounded-md bg-muted animate-pulse" />
                    <div className="col-span-2 h-4 rounded-md bg-muted animate-pulse" />
                  </div>
                ))}
              </div>
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
                    <TableHead className="w-[30%]">Name</TableHead>
                    <TableHead className="w-[35%]">File</TableHead>
                    <TableHead className="w-[10%] text-right">Coverage</TableHead>
                    <TableHead className="w-[10%] text-right">Status</TableHead>
                    <TableHead className="w-[15%] text-right">Actions</TableHead>
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
                      <TableCell className="text-right">
                        {!r.covered && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleAddCoverage(r.name, r.file)}
                            disabled={creatingTaskFor === r.name}
                          >
                            {creatingTaskFor === r.name ? (
                              <>
                                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                Creating...
                              </>
                            ) : (
                              <>
                                <Plus className="mr-2 h-3 w-3" />
                                Add Coverage
                              </>
                            )}
                          </Button>
                        )}
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