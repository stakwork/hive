"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceSettings } from "@/components/WorkspaceSettings";
import { WorkspaceMembers } from "@/components/workspace/WorkspaceMembers";
import { VMConfigSection } from "@/components/pool-status";
import { RerunIngest } from "@/components/RerunIngest";
import { Neo4jConfigSettings } from "@/components/settings/Neo4jConfigSettings";
import { VercelIntegrationSettings } from "@/components/settings/VercelIntegrationSettings";
import { SphinxIntegrationSettings } from "@/components/settings/SphinxIntegrationSettings";
import { ApiKeysSettings } from "@/components/settings/ApiKeysSettings";
import { NodeTypeOrderSettings } from "@/components/settings/NodeTypeOrderSettings";
import { DeleteWorkspace } from "@/components/DeleteWorkspace";

const VALID_TABS = ["general", "infrastructure", "integrations", "developer"] as const;
type TabValue = (typeof VALID_TABS)[number];

interface SettingsTabsProps {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  isOwner: boolean;
}

export function SettingsTabs({ workspaceId, workspaceName, workspaceSlug, isOwner }: SettingsTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get("tab") as TabValue | null;
  const activeTab: TabValue = tabParam && VALID_TABS.includes(tabParam) ? tabParam : "general";

  const handleTabChange = (value: string) => {
    router.replace(`?tab=${value}`, { scroll: false });
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList>
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="infrastructure">Infrastructure</TabsTrigger>
        <TabsTrigger value="integrations">Integrations</TabsTrigger>
        <TabsTrigger value="developer">Developer</TabsTrigger>
      </TabsList>

      <TabsContent value="general">
        <div className="max-w-2xl space-y-6 mt-6">
          <WorkspaceSettings />
          <WorkspaceMembers canAdmin />
          {isOwner && <DeleteWorkspace workspaceSlug={workspaceSlug} workspaceName={workspaceName} />}
        </div>
      </TabsContent>

      <TabsContent value="infrastructure">
        <div className="max-w-2xl space-y-6 mt-6">
          <VMConfigSection />
          <RerunIngest workspaceId={workspaceId} workspaceName={workspaceName} />
          <Neo4jConfigSettings />
        </div>
      </TabsContent>

      <TabsContent value="integrations">
        <div className="max-w-2xl space-y-6 mt-6">
          <VercelIntegrationSettings />
          <SphinxIntegrationSettings />
        </div>
      </TabsContent>

      <TabsContent value="developer">
        <div className="max-w-2xl space-y-6 mt-6">
          <ApiKeysSettings />
          <NodeTypeOrderSettings />
        </div>
      </TabsContent>

    </Tabs>
  );
}
