"use client";

import React from "react";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";
import { WorkspaceForm } from "@/components/onboarding/WorkspaceForm";

interface OnboardingWorkspaceClientProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    id: string;
    github?: {
      username?: string;
      publicRepos?: number;
      followers?: number;
    };
  };
}

export function OnboardingWorkspaceClient({ user }: OnboardingWorkspaceClientProps) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <OnboardingHeader
          title="Create Your Workspace"
          description="Welcome to Hive! Let's set up your workspace to get started."
        />
        <WorkspaceForm />
      </div>
    </div>
  );
}
