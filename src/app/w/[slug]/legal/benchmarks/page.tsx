"use client";

import { Scale } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { LegalBenchmarksPanel } from "@/components/legal/LegalBenchmarksPanel";

export default function LegalBenchmarksPage() {
  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={Scale}
        title="Legal Benchmarks"
        description="Harvey LAB — 1,749 real legal tasks across 25 practice areas"
      />
      <LegalBenchmarksPanel />
    </div>
  );
}
