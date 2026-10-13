"use client";

import React, { Suspense, useCallback, useState } from "react";
import { redirect, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Waypoints } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { CweListsTab } from "@/components/system-map/CweListsTab";
import { DomainNodesTab } from "@/components/system-map/DomainNodesTab";
import { SystemMapRuns } from "@/components/system-map/SystemMapRuns";

const TABS = ["overview", "cwe-lists", "nodes"] as const;
type SystemMapTab = (typeof TABS)[number];

function parseTab(value: string | null): SystemMapTab {
  return (TABS as readonly string[]).includes(value ?? "") ? (value as SystemMapTab) : "overview";
}

function SystemMapTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<SystemMapTab>(() => parseTab(searchParams?.get("tab") ?? null));

  const onTabChange = useCallback(
    (value: string) => {
      const next = parseTab(value);
      setTab(next);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (next === "overview") params.delete("tab");
      else params.set("tab", next);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return (
    <Tabs value={tab} onValueChange={onTabChange}>
      <TabsList data-testid="system-map-tabs">
        <TabsTrigger value="overview" data-testid="system-map-tab-overview">
          System map workflow
        </TabsTrigger>
        <TabsTrigger value="cwe-lists" data-testid="system-map-tab-cwe-lists">
          CWE lists
        </TabsTrigger>
        <TabsTrigger value="nodes" data-testid="system-map-tab-nodes">
          Domain nodes
        </TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="mt-4">
        <SystemMapRuns workflowKey="system_map" />
      </TabsContent>
      <TabsContent value="cwe-lists" className="mt-4">
        <CweListsTab />
      </TabsContent>
      <TabsContent value="nodes" className="mt-4">
        <DomainNodesTab />
      </TabsContent>
    </Tabs>
  );
}

export default function SystemMapPage() {
  const canAccess = useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION);
  if (!canAccess) {
    redirect("/");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Infosec"
        description="Security and system-map workflows for this workspace, the graphs they write, and the endpoints its systems call."
        icon={Waypoints}
      />
      <Suspense fallback={null}>
        <SystemMapTabs />
      </Suspense>
    </div>
  );
}
