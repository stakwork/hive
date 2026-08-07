"use client";

import { useState } from "react";
import { Scale } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { LegalBenchmarksPanel } from "@/components/legal/LegalBenchmarksPanel";
import { BenchmarkRunsHistory } from "@/components/legal/BenchmarkRunsHistory";
import { BenchmarkSummaryStrip } from "@/components/legal/BenchmarkSummaryStrip";
import { RecursionList } from "@/components/legal/RecursionBox";
import { useLegalBenchmarkRecursionList } from "@/hooks/useLegalBenchmarkRecursionList";
import { useLegalBenchmarkRunList } from "@/hooks/useLegalBenchmarkRunList";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type TabValue = "benchmark" | "runs" | "recursion";

function RecursionTab() {
  const { entries, isLoading, error, refetch } = useLegalBenchmarkRecursionList();

  return (
    <RecursionList
      entries={entries}
      isLoading={isLoading}
      error={error}
      refetch={refetch}
    />
  );
}

export default function LegalBenchmarksPage() {
  const { workspace } = useWorkspace();

  // Single run-list instance shared between BenchmarkSummaryStrip (header)
  // and BenchmarkRunsHistory (Runs tab) — avoids double fetch/poll/Pusher.
  const runList = useLegalBenchmarkRunList(workspace?.id);

  const [activeTab, setActiveTab] = useState<TabValue>("benchmark");

  // Token-based focus request: nonce ensures clicking the same pip twice
  // re-fires the effect even if the runId hasn't changed.
  const [focusRequest, setFocusRequest] = useState<{
    runId: string;
    nonce: number;
  } | null>(null);

  const handleSelectRun = (runId: string) => {
    setActiveTab("runs");
    setFocusRequest({ runId, nonce: Date.now() });
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={Scale}
        title="Legal Benchmarks"
        description="Harvey LAB — 1,749 real legal tasks across 25 practice areas"
        actions={
          <BenchmarkSummaryStrip
            runs={runList.runs}
            isLoading={runList.isLoading}
            error={runList.error}
            onSelectRun={handleSelectRun}
            onRetry={runList.refetch}
          />
        }
      />
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
        className="flex flex-col flex-1 min-h-0"
      >
        <div className="px-4 border-b">
          <TabsList>
            <TabsTrigger value="benchmark">Benchmark</TabsTrigger>
            <TabsTrigger value="runs">Runs</TabsTrigger>
            <TabsTrigger value="recursion">Recursion</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="benchmark" className="flex-1 min-h-0 pt-2">
          <LegalBenchmarksPanel className="h-full" />
        </TabsContent>
        <TabsContent value="runs" className="flex-1 min-h-0 overflow-auto p-4">
          <BenchmarkRunsHistory
            runList={runList}
            focusRequest={focusRequest}
            onFocusHandled={() => setFocusRequest(null)}
          />
        </TabsContent>
        <TabsContent value="recursion" className="flex-1 min-h-0 overflow-auto p-4">
          <RecursionTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
