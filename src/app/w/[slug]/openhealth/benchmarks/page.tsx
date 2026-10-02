"use client";

import { FlaskConical } from "lucide-react";
import { notFound, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { OPENHEALTH_SLUGS } from "@/lib/eval-capture-slugs";
import { PageHeader } from "@/components/ui/page-header";
import { OpenHealthTasksPanel } from "@/components/openhealth/OpenHealthTasksPanel";
import { OpenHealthRunsHistory } from "@/components/openhealth/OpenHealthRunsHistory";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type TabValue = "tasks" | "runs";

const parseTab = (value: string | null): TabValue => (value === "runs" ? "runs" : "tasks");

export default function OpenHealthBenchmarksPage() {
  const { workspace, loading } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  // The tab (and the open run) live in the URL: `?tab=runs&run=<id>`.
  const activeTab = parseTab(useSearchParams().get("tab"));

  // Page-level gate — /w/** is "public" in middleware so this guard is
  // required. The sidebar flag is a UX convenience only, NOT the gate: this
  // check (and the API routes' own slug checks) is the real enforcement.
  //
  // While the workspace is still loading, `workspace` is null and a naive
  // `workspace && !OPENHEALTH_SLUGS.includes(...)` guard would render the
  // panels for ANY slug in that window. Render nothing until loading
  // settles, then gate on the resolved workspace.
  if (loading) {
    return null;
  }
  if (!workspace || !OPENHEALTH_SLUGS.includes(workspace.slug)) {
    notFound();
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={FlaskConical}
        title="OpenHealth Benchmarks"
        description="Pick a patient chart and a benchmark, run it on strut, and see how the problem list or summary scored"
      />
      <Tabs
        value={activeTab}
        onValueChange={(tab) => router.replace(`${pathname}?tab=${tab}`, { scroll: false })}
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
