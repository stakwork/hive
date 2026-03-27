"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";

const TABS = [
  { label: "Learn", value: "learn" },
  { label: "Calls", value: "calls" },
  { label: "Agent Logs", value: "agent-logs" },
  { label: "Graph", value: "graph", adminOnly: true },
] as const;

// Sub-routes where we hide the tab bar and show a back button instead
const SUB_ROUTE_PATTERNS = [
  /\/context\/calls\/.+/,
  /\/context\/agent-logs\/chat/,
];

export default function ContextLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { slug } = useWorkspace();
  const { canAdmin } = useWorkspaceAccess();

  const isSubRoute = SUB_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));

  // Derive active tab from pathname (e.g. /w/slug/context/agent-logs -> "agent-logs")
  const activeTab = (() => {
    const match = pathname.match(/\/context\/([^/]+)/);
    return match ? match[1] : "learn";
  })();

  const visibleTabs = TABS.filter((tab) => !("adminOnly" in tab && tab.adminOnly) || canAdmin);

  if (!slug) return <>{children}</>;

  if (isSubRoute) {
    // Determine back destination
    const backHref = pathname.includes("/context/calls/")
      ? `/w/${slug}/context/calls`
      : `/w/${slug}/context/agent-logs`;

    return (
      <div className="flex flex-col h-full">
        <div className="flex-none border-b px-6 py-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={backHref}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Link>
          </Button>
        </div>
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none border-b px-6 pt-4">
        <Tabs value={activeTab}>
          <TabsList>
            {visibleTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} asChild>
                <Link href={`/w/${slug}/context/${tab.value}`}>{tab.label}</Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex-1 overflow-auto p-6">{children}</div>
    </div>
  );
}
