"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Brain } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LongMemoryPanel } from "@/components/longmemory/LongMemoryPanel";
import { LongMemoryRunsHistory } from "@/components/longmemory/LongMemoryRunsHistory";
import { useLongMemoryRuns } from "@/hooks/useLongMemoryRuns";

type TabValue = "benchmark" | "runs";

/** Parse `?tab=` into a valid tab; anything unrecognised lands on Benchmark. */
const parseTab = (value: string | null): TabValue => (value === "runs" ? "runs" : "benchmark");

export default function LongMemoryBenchmarksPage() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabValue>(() => parseTab(searchParams?.get("tab") ?? null));
  const { runs, isLoading, error, refetch } = useLongMemoryRuns();

  useEffect(() => {
    setActiveTab(parseTab(searchParams?.get("tab") ?? null));
  }, [searchParams]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={Brain}
        title="LongMemory"
        description="Long-term conversational memory QA, run on this workspace's strut"
      />
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="flex min-h-0 flex-1 flex-col">
        <div className="px-4 pb-3">
          <TabsList>
            <TabsTrigger value="benchmark">Benchmark</TabsTrigger>
            <TabsTrigger value="runs">Runs</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="benchmark" className="min-h-0 flex-1 pt-2">
          <LongMemoryPanel runs={runs} refetchRuns={refetch} />
        </TabsContent>
        <TabsContent value="runs" className="min-h-0 flex-1 overflow-auto p-4">
          <LongMemoryRunsHistory runs={runs} isLoading={isLoading} error={error} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
