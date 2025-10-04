"use client";

import { useState, useEffect } from "react";
import { Edit3, GitBranch, Server } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { useStakgraphStore } from "@/stores/useStakgraphStore";
import { GeneralTab, RepositoryTab, InfrastructureTab } from "./workspace-settings";

export function WorkspaceSettings() {
  const { workspace, refreshCurrentWorkspace } = useWorkspace();
  const { canAdmin } = useWorkspaceAccess();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("general");

  // Stakgraph store for repository and infrastructure data
  const {
    formData: stakgraphData,
    loadSettings,
    handleRepositoryChange,
    handleSwarmChange,
    errors: stakgraphErrors,
    loading: stakgraphLoading,
  } = useStakgraphStore();

  // Load stakgraph settings when workspace changes
  useEffect(() => {
    if (workspace?.slug) {
      loadSettings(workspace.slug);
    }
  }, [workspace?.slug, loadSettings]);

  if (!workspace || !canAdmin) {
    return null;
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="general" className="flex items-center gap-2">
          <Edit3 className="w-4 h-4" />
          General
        </TabsTrigger>
        <TabsTrigger value="repository" className="flex items-center gap-2">
          <GitBranch className="w-4 h-4" />
          Repository
        </TabsTrigger>
        <TabsTrigger value="infrastructure" className="flex items-center gap-2">
          <Server className="w-4 h-4" />
          Graph DB
        </TabsTrigger>
      </TabsList>

      <TabsContent value="general">
        <GeneralTab
          workspace={workspace}
          refreshCurrentWorkspace={refreshCurrentWorkspace}
          isSubmitting={isSubmitting}
          setIsSubmitting={setIsSubmitting}
        />
      </TabsContent>

      <TabsContent value="repository">
        <RepositoryTab
          workspace={workspace}
          stakgraphData={stakgraphData}
          stakgraphErrors={stakgraphErrors}
          stakgraphLoading={stakgraphLoading}
          isSubmitting={isSubmitting}
          setIsSubmitting={setIsSubmitting}
          handleRepositoryChange={handleRepositoryChange}
          loadSettings={loadSettings}
        />
      </TabsContent>

      <TabsContent value="infrastructure">
        <InfrastructureTab
          workspace={workspace}
          stakgraphData={stakgraphData}
          stakgraphErrors={stakgraphErrors}
          stakgraphLoading={stakgraphLoading}
          isSubmitting={isSubmitting}
          setIsSubmitting={setIsSubmitting}
          handleSwarmChange={handleSwarmChange}
          loadSettings={loadSettings}
        />
      </TabsContent>
    </Tabs>
  );
}
