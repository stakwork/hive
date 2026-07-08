"use client";

import { Scale } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { LegalBenchmarksPanel } from "@/components/legal/LegalBenchmarksPanel";
import { BenchmarkRunsHistory } from "@/components/legal/BenchmarkRunsHistory";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

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
          </TabsList>
        </div>
        <TabsContent value="benchmark" className="flex-1 min-h-0">
          <LegalBenchmarksPanel className="h-full" />
        </TabsContent>
        <TabsContent value="runs" className="flex-1 min-h-0 overflow-auto p-4">
          <BenchmarkRunsHistory />
        </TabsContent>
      </Tabs>
    </div>
  );
}
