"use client";

import { CoverageInsights } from "@/components/insights/CoverageInsights";
import { TestCoverageCard } from "@/components/insights/TestCoverageCard";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UserJourneys from "@/components/UserJourneys";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { redirect } from "next/navigation";

export default function DefenseTestingPage() {
  const canAccessDefense = useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION);

  if (!canAccessDefense) {
    redirect("/");
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Testing" />

      <div className="max-w-5xl">
        <Tabs defaultValue="coverage" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="coverage">Coverage</TabsTrigger>
            <TabsTrigger value="user-journeys">User Journeys</TabsTrigger>
          </TabsList>

          <TabsContent value="coverage" className="space-y-6 mt-6">
            <TestCoverageCard />
            <CoverageInsights />
          </TabsContent>

          <TabsContent value="user-journeys" className="mt-6">
            <UserJourneys />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
