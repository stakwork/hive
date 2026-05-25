"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useWorkspace } from "@/hooks/useWorkspace";
import { EvalDashboard } from "@/components/evals/EvalDashboard";

export default function EvalsPage() {
  const { workspace } = useWorkspace();
  const swarmConfigured = !!workspace?.swarmUrl;

  return (
    <div className="space-y-6">
      <PageHeader title="Evals" />
      {!swarmConfigured ? (
        <div className="text-muted-foreground text-sm">
          Swarm not configured for this workspace.
        </div>
      ) : (
        <EvalDashboard />
      )}
    </div>
  );
}
