"use client";

import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { notFound } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { OPENHEALTH_SLUGS } from "@/lib/eval-capture-slugs";
import { PageHeader } from "@/components/ui/page-header";
import { OpenHealthTasksPanel } from "@/components/openhealth/OpenHealthTasksPanel";
import { OpenHealthRunsHistory } from "@/components/openhealth/OpenHealthRunsHistory";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type TabValue = "tasks" | "runs";

export default function OpenHealthBenchmarksPage() {
  const { workspace } = useWorkspace();
  const [activeTab, setActiveTab] = useState<TabValue>("tasks");

  // Page-level gate — /w/** is "public" in middleware so this guard is
  // required. The sidebar flag is a UX convenience only, NOT the gate: this
  // check (and the API routes' own slug checks) is the real enforcement.
  // No isDevelopmentMode() bypass here, unlike the Legal gate.
  if (workspace && !OPENHEALTH_SLUGS.includes(workspace.slug)) {
    notFound();
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={FlaskConical}
        title="OpenHealth Benchmarks"
        description="Clinical benchmark tasks — public-split metadata, strut runs only"
      />
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
        className="flex flex-col flex-1 min-h-0"
      >
        <div className="px-4 pb-3">
          <TabsList>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="runs">Runs</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="tasks" className="flex-1 min-h-0 overflow-auto p-4">
          <OpenHealthTasksPanel />
        </TabsContent>
        <TabsContent value="runs" className="flex-1 min-h-0 overflow-auto p-4">
          <OpenHealthRunsHistory />
        </TabsContent>
      </Tabs>
    </div>
  );
}
