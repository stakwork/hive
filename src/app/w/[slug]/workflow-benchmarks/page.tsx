"use client";

import { Activity } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { WorkflowBenchmarksPanel } from "@/components/workflow-benchmarks";

export default function WorkflowBenchmarksPage() {
  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={Activity}
        title="Workflow Benchmarks"
        description="Automated evaluation of Stakwork workflow capabilities"
      />
      <div className="flex-1 min-h-0">
        <WorkflowBenchmarksPanel />
      </div>
    </div>
  );
}
