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
import { useLegalBenchmarkRunList } from "@/hooks/useLegalBenchmarkRunList";
import { useWorkspace } from "@/hooks/useWorkspace";
import { isLegalStrutWorkspace } from "@/lib/eval-capture-slugs";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type TabValue = "benchmark" | "runs" | "recursion" | "cnh";

const TAB_VALUES: readonly TabValue[] = ["benchmark", "runs", "recursion", "cnh"];

/** A strut legal workspace (`harvey-lab-run`) has no recursion and no C & H tasks. */
const STRUT_TAB_VALUES: readonly TabValue[] = ["benchmark", "runs"];

/** Parse `?tab=` into a valid tab; anything unrecognised lands on Benchmark. */
function parseTab(value: string | null, tabs: readonly TabValue[] = TAB_VALUES): TabValue {
  return (tabs as readonly string[]).includes(value ?? "")
    ? (value as TabValue)
    : "benchmark";
}

function RecursionTab() {
  const { workspace } = useWorkspace();
  const { entries, isLoading, error, refetch } = useLegalBenchmarkRecursionList();
  const { runs } = useLegalBenchmarkRunList(workspace?.id);

  return (
    <RecursionList
      entries={entries}
      isLoading={isLoading}
      error={error}
      refetch={refetch}
      allRuns={runs}
    />
  );
}

export default function LegalBenchmarksPage() {
  const searchParams = useSearchParams();
  const { workspace } = useWorkspace();
  const strut = isLegalStrutWorkspace(workspace?.slug);
  const tabs = strut ? STRUT_TAB_VALUES : TAB_VALUES;
  const [activeTab, setActiveTab] = useState<TabValue>(() =>
    parseTab(searchParams?.get("tab") ?? null, tabs),
  );

  // Follow ?tab= changes after mount — in-page links (e.g. the Runs tab's
  // recursion badge) navigate by query param rather than lifting tab state.
  useEffect(() => {
    setActiveTab(parseTab(searchParams?.get("tab") ?? null, tabs));
  }, [searchParams, tabs]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={Scale}
        title="Legal Benchmarks"
        description={
          strut
            ? "Harvey LAB — 1,749 real legal tasks across 25 practice areas, run on this workspace's strut"
            : "Harvey LAB — 1,749 real legal tasks across 25 practice areas"
        }
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
            {!strut && <TabsTrigger value="recursion">Recursion</TabsTrigger>}
            {!strut && <TabsTrigger value="cnh">C &amp; H Law Firm Tasks</TabsTrigger>}
          </TabsList>
        </div>
        <TabsContent value="benchmark" className="flex-1 min-h-0 pt-2">
          <LegalBenchmarksPanel className="h-full" />
        </TabsContent>
        <TabsContent value="runs" className="flex-1 min-h-0 overflow-auto p-4">
          <BenchmarkRunsHistory />
        </TabsContent>
        {!strut && (
          <TabsContent value="recursion" className="flex-1 min-h-0 overflow-auto p-4">
            <RecursionTab />
          </TabsContent>
        )}
        {!strut && (
          <TabsContent value="cnh" className="flex-1 min-h-0 overflow-hidden">
            <CnhMattersPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
