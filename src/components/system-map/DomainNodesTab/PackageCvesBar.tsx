"use client";

import React, { useCallback, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { SystemMapRuns } from "@/components/system-map/SystemMapRuns";
import type { SystemMapRun } from "@/types/system-map";
import { parsePackageCves, type VulnerablePackage } from "./package-cves";

const LABEL = "Package CVE check";

export interface PackageCvesResult {
  vulnerable: VulnerablePackage[];
  checkedAt: string;
}

/** The newest successful run's findings, or null when no run has any. */
function latestResult(runs: SystemMapRun[]): PackageCvesResult | null {
  for (const run of runs) {
    if (run.status !== "SUCCESS") continue;
    const vulnerable = parsePackageCves(run.output);
    if (vulnerable) return { vulnerable, checkedAt: run.settledAt ?? run.createdAt };
  }
  return null;
}

/**
 * Runs `swarm-systemmap-package-cves` on the workspace's swarm and lists its
 * runs; hands the newest successful run's findings to the Dependencies view.
 */
export function PackageCvesBar({ onResult }: { onResult: (result: PackageCvesResult | null) => void }) {
  const { workspace } = useWorkspace();
  const { canWrite } = useWorkspaceAccess();
  const slug = workspace?.slug;
  const [launching, setLaunching] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [runsKey, setRunsKey] = useState(0);

  const onRuns = useCallback(
    (runs: SystemMapRun[]) => {
      setInFlight(runs.some((run) => run.status === "PENDING"));
      onResult(latestResult(runs));
    },
    [onResult],
  );

  const launch = useCallback(async () => {
    if (!slug || launching) return;
    setLaunching(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/system-map/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow: "package_cves" }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        strutUrl?: string | null;
      };
      if (!response.ok) {
        const title =
          response.status === 409
            ? `A ${LABEL} is already in progress`
            : body.code === "workflow_missing"
              ? `${LABEL} workflow is not on this strut yet`
              : `Could not start the ${LABEL}`;
        toast.error(title, { description: body.error });
        return;
      }
      toast.success(`${LABEL} started`, {
        action: body.strutUrl ? { label: "View run", onClick: () => window.open(body.strutUrl!, "_blank") } : undefined,
      });
      setRunsKey((k) => k + 1);
    } catch (error) {
      toast.error(`Could not start the ${LABEL}`, {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setLaunching(false);
    }
  }, [slug, launching]);

  return (
    <Card data-testid="package-cves-bar">
      <CardContent className="space-y-3 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Look the packages up in OSV and highlight the ones with known vulnerabilities.
          </p>
          {canWrite && (
            <Button
              size="sm"
              className="ml-auto"
              disabled={!slug || launching || inFlight}
              onClick={() => void launch()}
              data-testid="package-cves-run"
            >
              {launching || inFlight ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldAlert className="mr-2 h-4 w-4" />
              )}
              {inFlight ? "Checking…" : "Check for CVEs"}
            </Button>
          )}
        </div>
        <SystemMapRuns workflowKey="package_cves" compact refreshKey={runsKey} onRuns={onRuns} />
      </CardContent>
    </Card>
  );
}
