"use client";

import { CoverageInsights } from "@/components/insights/CoverageInsights";
import { TestCoverageCard } from "@/components/insights/TestCoverageCard";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UserJourneys from "@/components/UserJourneys";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { redirect } from "next/navigation";
import { useState } from "react";

export default function DefenseTestingPage() {
  const canAccessDefense = useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION);
  const [isBrowserMode, setIsBrowserMode] = useState(false);

  if (!canAccessDefense) {
    redirect("/");
  }

  return (
    <div className="space-y-6">
      {!isBrowserMode && <PageHeader title="Testing" />}

      <div className={isBrowserMode ? "w-full" : "max-w-5xl"}>
        <Tabs defaultValue="coverage" className="w-full">
          {!isBrowserMode && (
            <TabsList data-testid="testing-tabs">
              <TabsTrigger value="coverage" data-testid="coverage-tab">Coverage</TabsTrigger>
              <TabsTrigger value="user-journeys" data-testid="user-journeys-tab">User Journeys</TabsTrigger>
            </TabsList>
          )}

          <TabsContent value="coverage" className="space-y-6 mt-6">
            <TestCoverageCard />
            <CoverageInsights />
          </TabsContent>

          <TabsContent value="user-journeys" className={isBrowserMode ? "" : "mt-6"}>
            <UserJourneys onBrowserModeChange={setIsBrowserMode} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
