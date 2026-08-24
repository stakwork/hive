"use client";

import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { notFound } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { isBenchmarkWorkspaceAllowed } from "@/lib/workflow-benchmarks/workspace-gate";
import { PageHeader } from "@/components/ui/page-header";
import { WorkflowBenchmarksPanel } from "@/components/workflow-benchmarks/WorkflowBenchmarksPanel";
import { WorkflowBenchmarkRunsHistory } from "@/components/workflow-benchmarks/WorkflowBenchmarkRunsHistory";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type TabValue = "benchmark" | "runs";

export default function WorkflowBenchmarksPage() {
  const { workspace } = useWorkspace();
  const [activeTab, setActiveTab] = useState<TabValue>("benchmark");

  // Page-level gate — /w/** is "public" in middleware so this guard is required.
  // All data comes from authenticated API routes; no server-side fetches here.
  if (workspace && !isBenchmarkWorkspaceAllowed(workspace.slug)) {
    notFound();
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={FlaskConical}
        title="Workflow Benchmarks"
        description="Rerunnable, comparable, partial-credit scoring for the Workflow Editor agent"
      />
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
        className="flex flex-col flex-1 min-h-0"
      >
        <div className="px-4 pb-3">
          <TabsList>
            <TabsTrigger value="benchmark">Benchmark</TabsTrigger>
            <TabsTrigger value="runs">Runs</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="benchmark" className="flex-1 min-h-0 overflow-auto p-4">
          <WorkflowBenchmarksPanel />
        </TabsContent>
        <TabsContent value="runs" className="flex-1 min-h-0 overflow-auto p-4">
          <WorkflowBenchmarkRunsHistory />
        </TabsContent>
      </Tabs>
    </div>
  );
}
