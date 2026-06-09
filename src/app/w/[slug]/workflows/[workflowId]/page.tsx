"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Workflow, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkflowVersions } from "@/hooks/useWorkflowVersions";
import { WorkflowVersionSelector } from "@/components/workflow/WorkflowVersionSelector";
import WorkflowComponent from "@/components/workflow";
import { WorkflowStatsPanel } from "@/components/workflow/inspector/WorkflowStatsPanel";
import { WorkflowParamsTable } from "@/components/workflow/inspector/WorkflowParamsTable";
import { WorkflowVersionList } from "@/components/workflow/inspector/WorkflowVersionList";
import { WorkflowVersionDiff } from "@/components/workflow/inspector/WorkflowVersionDiff";
import { createWorkflowEditorTask } from "@/lib/workflow/create-workflow-editor-task";

function parseWorkflowJson(workflowJson: string | null | undefined): Record<string, unknown> | null {
  if (!workflowJson) return null;
  if (typeof workflowJson === "object") return workflowJson as Record<string, unknown>;
  try {
    let data: string | Record<string, unknown> = workflowJson;
    // Remove wrapper quotes from graph API format
    if (typeof data === "string") {
      if (data.startsWith('\\"') && data.endsWith('\\"')) {
        data = data.slice(2, -2);
      } else if (data.startsWith('"') && data.endsWith('"')) {
        data = data.slice(1, -1);
      }
    }
    while (typeof data === "string") {
      data = JSON.parse(data);
    }
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default function WorkflowInspectorPage() {
  const params = useParams();
  const router = useRouter();
  const { slug } = useWorkspace();

  const workflowIdRaw = params?.workflowId as string | undefined;
  const workflowIdNum = workflowIdRaw ? parseInt(workflowIdRaw, 10) : NaN;

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [isCreatingTask, setIsCreatingTask] = useState(false);

  const { versions, isLoading: isLoadingVersions } = useWorkflowVersions(
    slug || null,
    isNaN(workflowIdNum) ? null : workflowIdNum,
  );

  // Auto-select first version
  useEffect(() => {
    if (!selectedVersionId && versions.length > 0) {
      setSelectedVersionId(versions[0].workflow_version_id);
    }
  }, [versions, selectedVersionId]);

  // Reset selection when workflowId changes
  useEffect(() => {
    setSelectedVersionId(null);
  }, [workflowIdNum]);

  const selectedVersion = useMemo(
    () => versions.find((v) => v.workflow_version_id === selectedVersionId) ?? null,
    [versions, selectedVersionId],
  );

  const workflowName = selectedVersion?.workflow_name ?? `Workflow ${workflowIdRaw}`;

  const parsedWorkflowData = useMemo(
    () => parseWorkflowJson(selectedVersion?.workflow_json),
    [selectedVersion],
  );

  const previousVersion = useMemo(() => {
    if (!selectedVersion) return null;
    const idx = versions.indexOf(selectedVersion);
    return versions[idx + 1] ?? null;
  }, [versions, selectedVersion]);

  const handleOpenInEditor = async () => {
    if (!selectedVersion || !slug) return;
    setIsCreatingTask(true);
    try {
      const taskId = await createWorkflowEditorTask(slug, selectedVersion, workflowName);
      router.push(`/w/${slug}/task/${taskId}`);
    } catch {
      toast.error("Failed to create editor task");
    } finally {
      setIsCreatingTask(false);
    }
  };

  const handlePlanFromWorkflow = () => {
    if (!slug) return;
    router.push(
      `/w/${slug}/plan/new?workflowId=${workflowIdNum}&workflowName=${encodeURIComponent(workflowName)}`,
    );
  };

  // NaN workflowId — render error immediately
  if (isNaN(workflowIdNum)) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">Invalid workflow ID.</p>
        <Button asChild variant="outline">
          <Link href={slug ? `/w/${slug}/workflows` : "/workflows"}>Back to Workflows</Link>
        </Button>
      </div>
    );
  }

  // Not found / not accessible
  if (!isLoadingVersions && versions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">Workflow not found or not accessible.</p>
        <Button asChild variant="outline">
          <Link href={slug ? `/w/${slug}/workflows` : "/workflows"}>Back to Workflows</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={workflowName}
        icon={Workflow}
        description={`ID: ${workflowIdNum}`}
        actions={
          <>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link href={slug ? `/w/${slug}/workflows` : "/workflows"}>
                <ArrowLeft className="w-4 h-4 mr-1" />
                Workflows
              </Link>
            </Button>
            <Button onClick={handlePlanFromWorkflow} variant="outline" size="sm">
              Plan from this Workflow
            </Button>
            <Button
              onClick={handleOpenInEditor}
              disabled={!selectedVersion || isCreatingTask}
              size="sm"
            >
              {isCreatingTask && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Open in Editor
            </Button>
          </>
        }
      />

      <div className="flex gap-4 h-[calc(100vh-12rem)]">
        {/* Left 60%: flow diagram */}
        <div className="flex-[3] min-w-0 border rounded-lg overflow-hidden flex flex-col">
          <div className="flex-1 overflow-hidden">
            {parsedWorkflowData ? (
              <WorkflowComponent
                props={{
                  workflowData: parsedWorkflowData,
                  show_only: true,
                  mode: "workflow",
                  projectId: "",
                  isAdmin: false,
                  workflowId: String(workflowIdNum),
                  workflowVersion: selectedVersionId ? String(selectedVersionId) : "",
                  defaultZoomLevel: 0.65,
                  useAssistantDimensions: false,
                  rails_env: process.env.NEXT_PUBLIC_RAILS_ENV || "production",
                }}
              />
            ) : isLoadingVersions ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading workflow...
              </div>
            ) : null}
          </div>
          {/* Version selector below diagram */}
          <div className="border-t p-3 shrink-0">
            <WorkflowVersionSelector
              versions={versions}
              selectedVersionId={selectedVersionId}
              onVersionSelect={setSelectedVersionId}
              isLoading={isLoadingVersions}
              workflowName={workflowName}
            />
          </div>
        </div>

        {/* Right 40%: tabbed detail */}
        <div className="flex-[2] min-w-0 border rounded-lg overflow-hidden flex flex-col">
          <Tabs defaultValue="stats" className="flex flex-col h-full">
            <div className="border-b px-3 pt-3 shrink-0">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="stats">Stats</TabsTrigger>
                <TabsTrigger value="params">Params</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto">
              <TabsContent value="stats" className="mt-0">
                {slug && (
                  <WorkflowStatsPanel slug={slug} workflowId={workflowIdNum} />
                )}
              </TabsContent>

              <TabsContent value="params" className="mt-0">
                <WorkflowParamsTable
                  workflowJson={selectedVersion?.workflow_json ?? null}
                />
              </TabsContent>

              <TabsContent value="history" className="mt-0 p-4">
                <WorkflowVersionList
                  versions={versions}
                  selectedVersionId={selectedVersionId}
                  onVersionSelect={setSelectedVersionId}
                />
                {selectedVersion && (
                  <WorkflowVersionDiff
                    currentJson={selectedVersion.workflow_json}
                    previousJson={previousVersion?.workflow_json ?? null}
                  />
                )}
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
