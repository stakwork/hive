"use client";

import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import UserJourneys from "@/components/UserJourneys";

export default function TestingPage() {
  const hasCodebaseRecommendation = useFeatureFlag("CODEBASE_RECOMMENDATION");

  if (!hasCodebaseRecommendation) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">
          This feature is not available in your workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <UserJourneys />
    </div>
  );
}