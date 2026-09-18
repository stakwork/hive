"use client";

import { useCallback, useEffect, useState } from "react";
import { redirect } from "next/navigation";
import { Loader2, Plus, Shield, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FindingsList } from "@/components/protect/FindingsList";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { toast } from "sonner";
import type { ProtectFindingsResponse, ProtectScopePayload } from "@/types/protect";

const EMPTY_SCOPE: ProtectScopePayload = {
  repositories: [],
  selected: [],
  empty: true,
};

export default function ProtectPage() {
  const canAccessDefense = useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION);
  const { workspace } = useWorkspace();
  const { canAdmin, canWrite } = useWorkspaceAccess();
  const [data, setData] = useState<ProtectFindingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [updatingScope, setUpdatingScope] = useState(false);
  const [pendingRepoId, setPendingRepoId] = useState<string>("");

  const loadFindings = useCallback(async (slug: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/protect/findings`);
      if (!response.ok) {
        throw new Error("Failed to load findings");
      }
      const body = (await response.json()) as ProtectFindingsResponse;
      setData({
        ...body,
        scope: body.scope ?? EMPTY_SCOPE,
      });
    } catch (error) {
      toast.error("Could not load Protect findings", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      setData({
        status: "error",
        findings: [],
        run: null,
        scope: EMPTY_SCOPE,
        error: "Failed to load findings",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (workspace?.slug) {
      void loadFindings(workspace.slug);
    }
  }, [workspace?.slug, loadFindings]);

  if (!canAccessDefense) {
    redirect("/");
  }

  const scope = data?.scope ?? EMPTY_SCOPE;
  const scopeEmpty = scope.empty;
  const inProgress = data?.status === "in-progress" || running;
  const runDisabled = !canAdmin || inProgress || running || scopeEmpty;
  const availableRepos = scope.repositories.filter((repo) => !repo.inScope);
  const selectedRepos = scope.repositories.filter((repo) => repo.inScope);

  const handleRunReview = async () => {
    if (!workspace?.slug) return;
    setRunning(true);
    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}/protect/run`, {
        method: "POST",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Failed to start review");
      }
      toast("Protect review started");
      await loadFindings(workspace.slug);
    } catch (error) {
      toast.error("Could not start review", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setRunning(false);
    }
  };

  const updateScope = async (repositoryId: string, inScope: boolean) => {
    if (!workspace?.slug) return;
    setUpdatingScope(true);
    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}/protect/scope`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId, inScope }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Failed to update scope");
      }
      setData((current) =>
        current
          ? { ...current, scope: body.scope as ProtectScopePayload }
          : current,
      );
      setPendingRepoId("");
    } catch (error) {
      toast.error("Could not update review scope", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setUpdatingScope(false);
    }
  };

  const emptyCopy = (() => {
    if (scopeEmpty) {
      return canAdmin
        ? "Add a repository to the review scope, then run a full review."
        : "No repositories are in the review scope yet. Ask an admin to add one.";
    }
    return canAdmin
      ? "No review has run yet. Run a full review of the selected repositories."
      : "No review has run yet. Ask an admin to run a review.";
  })();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Protect"
        description="Security findings for repositories in the review scope."
        icon={Shield}
        actions={
          canAdmin ? (
            <Button
              onClick={handleRunReview}
              disabled={runDisabled}
              data-testid="protect-run-review"
            >
              {(running || inProgress) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Run review
            </Button>
          ) : undefined
        }
      />

      <div className="max-w-5xl space-y-6">
        <Card data-testid="protect-scope">
          <CardContent className="space-y-4 py-5">
            <div>
              <h2 className="text-sm font-medium">Review scope</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Only selected repositories are scanned. Scope starts empty.
              </p>
            </div>

            {selectedRepos.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="protect-scope-empty">
                No repositories selected.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2" data-testid="protect-scope-selected">
                {selectedRepos.map((repo) => (
                  <li
                    key={repo.id}
                    className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-sm"
                  >
                    <span>{repo.name}</span>
                    {canAdmin && (
                      <button
                        type="button"
                        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${repo.name} from scope`}
                        data-testid={`protect-scope-remove-${repo.id}`}
                        disabled={updatingScope}
                        onClick={() => void updateScope(repo.id, false)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canAdmin && availableRepos.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={pendingRepoId || undefined}
                  onValueChange={setPendingRepoId}
                  disabled={updatingScope}
                >
                  <SelectTrigger className="w-64" data-testid="protect-scope-select">
                    <SelectValue placeholder="Add a repository" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRepos.map((repo) => (
                      <SelectItem key={repo.id} value={repo.id}>
                        {repo.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!pendingRepoId || updatingScope}
                  data-testid="protect-scope-add"
                  onClick={() => {
                    if (pendingRepoId) void updateScope(pendingRepoId, true);
                  }}
                >
                  {updatingScope ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Add
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {loading && (
          <Card data-testid="protect-loading">
            <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading findings…
            </CardContent>
          </Card>
        )}

        {!loading && data?.status === "empty" && (
          <Card data-testid="protect-empty">
            <CardContent className="py-10 text-sm text-muted-foreground">
              {emptyCopy}
            </CardContent>
          </Card>
        )}

        {!loading && data?.status === "in-progress" && (
          <Card data-testid="protect-in-progress">
            <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Review in progress.
            </CardContent>
          </Card>
        )}

        {!loading && data?.status === "error" && (
          <Card data-testid="protect-error">
            <CardContent className="py-10 text-sm text-muted-foreground">
              {data.error || "Could not load findings from the knowledge graph."}
            </CardContent>
          </Card>
        )}

        {!loading && data?.status === "ready" && workspace?.slug && (
          <FindingsList slug={workspace.slug} findings={data.findings} canWrite={canWrite} />
        )}
      </div>
    </div>
  );
}
