"use client";

import { useState, useCallback } from "react";
import { Scale } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { LegalBenchmarksPanel } from "@/components/legal/LegalBenchmarksPanel";
import { BenchmarkRunsHistory } from "@/components/legal/BenchmarkRunsHistory";
import { RecursionList } from "@/components/legal/RecursionBox";
import { useLegalBenchmarkRecursionList } from "@/hooks/useLegalBenchmarkRecursionList";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

function RecursionTab() {
  const { entries, isLoading, error, refetch } = useLegalBenchmarkRecursionList();
  const [localEntries, setLocalEntries] = useState(entries);

  // Sync local entries with fetched entries
  const syncedEntries = localEntries.length === 0 && entries.length > 0 ? entries : localEntries;
  // Keep local entries in sync when refetch returns new data
  // We use a merged view: show fetched entries but allow optimistic removals
  const displayEntries = entries.map((e) => e); // use fresh data always

  const handleRemove = useCallback((id: string) => {
    // Optimistically remove from the displayed list; refetch will confirm
    void refetch();
    setLocalEntries((prev) => prev.filter((e) => e.id !== id));
  }, [refetch]);

  return (
    <RecursionList
      entries={displayEntries}
      isLoading={isLoading}
      error={error}
      refetch={refetch}
      onRemove={handleRemove}
    />
  );
}

export default function LegalBenchmarksPage() {
  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={Scale}
        title="Legal Benchmarks"
        description="Harvey LAB — 1,749 real legal tasks across 25 practice areas"
      />
      <Tabs defaultValue="benchmark" className="flex flex-col flex-1 min-h-0">
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
          <BenchmarkRunsHistory />
        </TabsContent>
        <TabsContent value="recursion" className="flex-1 min-h-0 overflow-auto p-4">
          <RecursionTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
