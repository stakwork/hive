"use client";

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
    <div className="h-full">
      <UserJourneys />
    </div>
  );
}
