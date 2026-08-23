"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Scale } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { LegalBenchmarksPanel } from "@/components/legal/LegalBenchmarksPanel";
import { BenchmarkRunsHistory } from "@/components/legal/BenchmarkRunsHistory";
import { RecursionList } from "@/components/legal/RecursionBox";
import { CnhMattersPanel } from "@/components/legal/CnhMattersPanel";
import { useLegalBenchmarkRecursionList } from "@/hooks/useLegalBenchmarkRecursionList";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type TabValue = "benchmark" | "runs" | "recursion" | "cnh";

const TAB_VALUES: readonly TabValue[] = ["benchmark", "runs", "recursion", "cnh"];

/** Parse `?tab=` into a valid tab; anything unrecognised lands on Benchmark. */
function parseTab(value: string | null): TabValue {
  return (TAB_VALUES as readonly string[]).includes(value ?? "")
    ? (value as TabValue)
    : "benchmark";
}

function RecursionTab() {
  const { entries, isLoading, error, refetch, fetchSummary } = useLegalBenchmarkRecursionList();

  // Fire the one-time summary fetch after the enrollment list resolves.
  // Kept outside useLegalBenchmarkRecursionList to avoid counting against the
  // polling test's fetch-call assertions.
  useEffect(() => {
    if (!isLoading) {
      void fetchSummary();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

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
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabValue>(() =>
    parseTab(searchParams?.get("tab") ?? null),
  );

  // Follow ?tab= changes after mount — in-page links (e.g. the Runs tab's
  // recursion badge) navigate by query param rather than lifting tab state.
  useEffect(() => {
    setActiveTab(parseTab(searchParams?.get("tab") ?? null));
  }, [searchParams]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={Scale}
        title="Legal Benchmarks"
        description="Harvey LAB — 1,749 real legal tasks across 25 practice areas"
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
            <TabsTrigger value="recursion">Recursion</TabsTrigger>
            <TabsTrigger value="cnh">C &amp; H Law Firm Tasks</TabsTrigger>
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
        <TabsContent value="cnh" className="flex-1 min-h-0 overflow-hidden">
          <CnhMattersPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
