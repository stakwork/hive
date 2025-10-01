"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/hooks/useWorkspace";
import { cn, formatRelativeTime } from "@/lib/utils";
import { CheckCircle, Clock, MoreHorizontal, Server, Settings, Zap, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useModal } from "../modals/ModlaProvider";
import { useState, useEffect, useCallback } from "react";
import { PoolStatusResponse } from "@/types";

export function VMConfigSection() {
  const { slug, workspace } = useWorkspace();

  const open = useModal();

  const poolState = workspace?.poolState;

  const [poolStatus, setPoolStatus] = useState<PoolStatusResponse | null>(null);

  const fetchPoolStatus = useCallback(async () => {
    if (!slug) {
      setPoolStatus(null);
      return;
    }

    try {
      const response = await fetch(`/api/w/${slug}/pool/status`);

      if (!response.ok) {
        return;
      }

      const result = await response.json();

      if (!result.success) {
        return;
      }

      setPoolStatus(result.data);
    } catch (error) {
      // Silently handle errors
    }
  }, [slug]);

  useEffect(() => {
    fetchPoolStatus();
  }, [fetchPoolStatus]);

  const swarmStatus = poolState === "COMPLETE" ? "ACTIVE" : "PENDING";


  // Determine UI state based on swarm status
  const getVMState = () => {

    switch (swarmStatus) {
      case "ACTIVE":
        return {
          buttonText: "Edit",
          buttonHref: ``,
          statusBadge: {
            text: "Active",
            variant: "default" as const,
            icon: CheckCircle,
            className: "bg-green-100 text-green-800 border-green-200"
          },
          description: "Manage environment variables and services any time."
        };
      case "PENDING":
        return {
          buttonText: "Finish setup",
          buttonHref: `/w/${slug}/code-graph`,
          statusBadge: {
            text: "In progress",
            variant: "secondary" as const,
            icon: Clock,
            className: "bg-orange-100 text-orange-800 border-orange-200"
          },
          description: "Finish your setup to get started."
        };
    }
  };

  const vmState = getVMState();

  const handleOpenModal = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();

    open("ServicesWizard");

  }



  return (
    <Card className="relative">
      {swarmStatus === "ACTIVE" && (
        <div className="absolute top-4 right-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/w/${slug}/stakgraph`} className="cursor-pointer">
                  <Settings className="w-4 h-4 mr-2" />
                  Edit Configuration
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="w-5 h-5" />
          Pool Status
        </CardTitle>
        <CardDescription>
          {vmState.description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          {swarmStatus ? (
            poolStatus?.status && swarmStatus === "ACTIVE" ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className={poolStatus.status.runningVms > 0 ? "text-green-600" : "text-muted-foreground"}>
                    {poolStatus.status.runningVms} running
                  </span>
                  <span className="text-muted-foreground">•</span>
                  <span className={poolStatus.status.pendingVms > 0 ? "text-orange-600" : "text-muted-foreground"}>
                    {poolStatus.status.pendingVms} pending
                  </span>
                  {poolStatus.status.failedVms > 0 && (
                    <>
                      <span className="text-muted-foreground">•</span>
                      <span className="text-red-600">
                        {poolStatus.status.failedVms} failed
                      </span>
                    </>
                  )}
                </div>
                {poolStatus.status.lastCheck && (
                  <div className="text-xs text-muted-foreground">
                    Updated {formatRelativeTime(poolStatus.status.lastCheck.endsWith('Z') ? poolStatus.status.lastCheck : poolStatus.status.lastCheck + 'Z')}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className={cn(
                  "relative flex items-center justify-center w-12 h-12 rounded-full",
                  swarmStatus === "PENDING" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-700"
                )}>
                  {swarmStatus === "PENDING" && (
                    <>
                      <Clock className="w-6 h-6" />
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full animate-pulse" />
                    </>
                  )}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{vmState.statusBadge.text}</span>
                  <span className="text-xs text-muted-foreground">{vmState.description}</span>
                </div>
                <Button asChild>
                  <Link onClick={handleOpenModal} href={slug ? vmState.buttonHref : "#"}>
                    <Zap className="w-4 h-4 mr-2" />
                    {vmState.buttonText}
                  </Link>
                </Button>
              </div>
            )
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 text-blue-700">
                <Zap className="w-6 h-6" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium">Set up Pool</span>
                <span className="text-xs text-muted-foreground">Get started now</span>
              </div>
              <Button asChild>
                <Link onClick={handleOpenModal} href={slug ? vmState.buttonHref : "#"}>
                  <Zap className="w-4 h-4 mr-2" />
                  Set up
                </Link>
              </Button>
            </div>
          )}
        </div>


      </CardContent>
    </Card>
  );
}