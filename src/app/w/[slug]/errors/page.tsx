"use client";

import React, { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Bug, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorIssuesTable } from "@/components/errors";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useErrorIssues } from "@/hooks/useErrorIssues";
import { canonicalRepoKey } from "@/lib/utils/error-fingerprint";
import type { ErrorIssueStatus } from "@/types/error-issues";

const ISSUES_PER_PAGE = 20;

const ALL_VALUE = "__all__";

function parseStatus(v: string): ErrorIssueStatus | "all" {
  return v === ALL_VALUE ? "all" : (v as ErrorIssueStatus);
}

export default function ErrorsPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const { id: workspaceId, workspace } = useWorkspace();

  const [statusFilter, setStatusFilter] = useState<ErrorIssueStatus | "all">("UNRESOLVED");
  const [repoKeyFilter, setRepoKeyFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);

  const skip = (page - 1) * ISSUES_PER_PAGE;

  const { issues, hasMore, loading, error, refetch } = useErrorIssues({
    workspaceId,
    slug,
    status: statusFilter,
    repoKey: repoKeyFilter,
    skip,
    limit: ISSUES_PER_PAGE,
  });

  // Derive unique repo keys from current issues for the repo filter
  const repoKeys = Array.from(new Set(issues.map((i) => i.repoKey).filter(Boolean)));

  // Also include workspace repositories for pre-filtering (canonical form)
  const workspaceRepoKeys = (workspace?.repositories ?? []).map((r) =>
    canonicalRepoKey(r.repositoryUrl || r.name),
  );
  const allRepoKeys = Array.from(new Set([...workspaceRepoKeys, ...repoKeys]));

  const handleStatusChange = (val: string) => {
    setStatusFilter(parseStatus(val));
    setPage(1);
  };

  const handleRepoKeyChange = (val: string) => {
    setRepoKeyFilter(val === ALL_VALUE ? undefined : val);
    setPage(1);
  };

  const handleStatusChangePatch = useCallback(
    (_issueId: string, _newStatus: ErrorIssueStatus) => {
      refetch();
    },
    [refetch],
  );

  return (
    <div className="space-y-6">
      <PageHeader icon={Bug} title="Errors" />

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Error Issues</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {/* Status filter */}
              <Select
                value={statusFilter === "all" ? ALL_VALUE : statusFilter}
                onValueChange={handleStatusChange}
              >
                <SelectTrigger className="w-full sm:w-40" data-testid="status-filter">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All statuses</SelectItem>
                  <SelectItem value="UNRESOLVED">Unresolved</SelectItem>
                  <SelectItem value="RESOLVED">Resolved</SelectItem>
                  <SelectItem value="IGNORED">Ignored</SelectItem>
                </SelectContent>
              </Select>

              {/* Repo filter */}
              <Select
                value={repoKeyFilter ?? ALL_VALUE}
                onValueChange={handleRepoKeyChange}
              >
                <SelectTrigger className="w-full sm:w-48" data-testid="repo-filter">
                  <SelectValue placeholder="All repositories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All repositories</SelectItem>
                  {allRepoKeys.map((key) => (
                    <SelectItem key={key} value={key}>
                      {key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <ErrorIssuesTable
            issues={issues}
            loading={loading}
            error={error}
            onRowClick={(id) => router.push(`/w/${slug}/errors/${id}`)}
            onStatusChange={handleStatusChangePatch}
          />

          {!loading && !error && issues.length > 0 && (
            <div className="mt-6">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <Button
                      variant="ghost"
                      size="default"
                      onClick={() => setPage(Math.max(1, page - 1))}
                      disabled={page === 1}
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
                      className={buttonVariants({ variant: "outline", size: "icon" })}
                      disabled
                    >
                      {page}
                    </Button>
                  </PaginationItem>

                  {hasMore && (
                    <PaginationItem>
                      <Button
                        variant="ghost"
                        size="default"
                        onClick={() => setPage(page + 1)}
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
      </Card>
    </div>
  );
}
