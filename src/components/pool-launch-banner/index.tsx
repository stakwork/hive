"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Server } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useModal } from "@/components/modals/ModlaProvider";

interface PoolLaunchBannerProps {
  workspaceSlug: string;
  title?: string;
  description?: string;
}

export function PoolLaunchBanner({
  workspaceSlug,
  title = "Complete Pool Setup",
  description = "Launch your development pods to continue.",
}: PoolLaunchBannerProps) {
  const { workspace } = useWorkspace();
  const open = useModal();

  // Return null when workspace is not available or pool is complete
  if (!workspace || workspace.poolState === "COMPLETE") {
    return null;
  }

  const servicesReady = workspace.containerFilesSetUp === true;

  const handleLaunchPods = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    open("ServicesWizard");
  };

  // Setting up state - services not ready yet
  if (!servicesReady) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="relative flex items-center justify-center">
              <Server className="h-5 w-5 text-foreground" />
              <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
            </div>
            Setting up...
          </CardTitle>
          <CardDescription>
            Your development environment is being prepared. This may take a few moments.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Ready to launch pods
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleLaunchPods} size="lg" className="flex items-center gap-2">
          <Server className="h-4 w-4" />
          Launch Pods
        </Button>
      </CardContent>
    </Card>
  );
}
