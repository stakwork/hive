"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useModal } from "@/hooks/useModal";
import { cn } from "@/lib/utils";
import { Activity, CheckCircle, Clock, MoreHorizontal, Server, Settings, Zap } from "lucide-react";
import Link from "next/link";

export function VMConfigSection() {
  const { slug, workspace } = useWorkspace();
  const swarmStatus = workspace?.swarmStatus;
  const { open: openModal } = useModal();

  const codeIngested = workspace?.codeIngested;
  const poolState = workspace?.poolState;
  const poolStateCompleted = workspace?.poolState === "COMPLETE";

  console.log(poolStateCompleted);

  // Check if we should show the modal
  const shouldShowWarning = poolState !== "STARTED" || codeIngested === false;

  const handleWarningClick = () => {
    if (shouldShowWarning) {
      openModal({
        title: "VM Configuration Status",
        description: "Here is the current status of your virtual machine configuration.",
        content: (
          <div className="space-y-4">
            <div className="space-y-2">
              <h4 className="font-medium">Current Status:</h4>
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span>Pool State:</span>
                  <span className={poolState === "STARTED" ? "text-green-600" : "text-blue-600"}>
                    {poolState || "NOT_STARTED"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Code Ingested:</span>
                  <span className={codeIngested ? "text-green-600" : "text-blue-600"}>
                    {String(codeIngested)}
                  </span>
                </div>
              </div>
            </div>

            {poolState !== "STARTED" && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                <p className="text-sm text-blue-800">
                  <strong>Pool not started:</strong> Your compute pool needs to be initialized before you can run workloads.
                </p>
              </div>
            )}

            {codeIngested === false && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                <p className="text-sm text-blue-800">
                  <strong>Code not ingested:</strong> Your codebase has not been processed yet. This is required for code analysis and AI assistance.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              {slug && (
                <Button asChild>
                  <Link href={`/w/${slug}/code-graph`}>
                    Configure VM
                  </Link>
                </Button>
              )}
            </div>
          </div>
        ),
        size: 'md'
      });
    }
  };

  // Determine UI state based on swarm status
  const getVMState = () => {
    if (!swarmStatus) {
      return {
        buttonText: "Setup VM",
        buttonHref: `/w/${slug}/code-graph`,
        statusBadge: null,
        description: "Set up your virtual machine to start developing"
      };
    }

    switch (swarmStatus) {
      case "ACTIVE":
        return {
          buttonText: "Edit",
          buttonHref: `/w/${slug}/stakgraph`,
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
          buttonText: "View Progress",
          buttonHref: `/w/${slug}/code-graph`,
          statusBadge: {
            text: "VM Spinning Up",
            variant: "secondary" as const,
            icon: Clock,
            className: "bg-orange-100 text-orange-800 border-orange-200"
          },
          description: "Your graph infrastructure is being spun up, this may take a few minutes."
        };
      default:
        return {
          buttonText: "Start setup",
          buttonHref: `/w/${slug}/code-graph`,
          statusBadge: null,
          description: "Create a virtual machine environment for your codebase."
        };
    }
  };

  const vmState = getVMState();

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
          VM Configuration
        </CardTitle>
        <CardDescription>
          {vmState.description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          {/* Left side - Cool status display */}
          <div className="flex items-center gap-4">
            {swarmStatus ? (
              <div className="flex items-center gap-3">
                <div className={cn(
                  "relative flex items-center justify-center w-12 h-12 rounded-full",
                  swarmStatus === "ACTIVE" ? "bg-green-100 text-green-700" :
                    swarmStatus === "PENDING" ? "bg-orange-100 text-orange-700" :
                      "bg-gray-100 text-gray-700"
                )}>
                  {swarmStatus === "ACTIVE" && (
                    <>
                      <CheckCircle className="w-6 h-6" />
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                    </>
                  )}
                  {swarmStatus === "PENDING" && (
                    <>
                      <Clock className="w-6 h-6 animate-spin" />
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full animate-pulse" />
                    </>
                  )}
                  {swarmStatus !== "ACTIVE" && swarmStatus !== "PENDING" && (
                    <Activity className="w-6 h-6" />
                  )}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {swarmStatus === "ACTIVE" ? "Active" :
                      swarmStatus === "PENDING" ? "In Progress" :
                        "Set up VM"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {swarmStatus === "ACTIVE" ? "Your VMs are running." :
                      swarmStatus === "PENDING" ? "Please wait..." :
                        "Ingest your codebase"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 text-blue-700">
                  <Zap className="w-6 h-6" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Set up VMs</span>
                  <span className="text-xs text-muted-foreground">Get started now</span>
                </div>
              </div>
            )}
          </div>

          {/* Right side - Action button */}
          {swarmStatus !== "ACTIVE" && (
            <Button asChild>
              <Link href={slug ? vmState.buttonHref : "#"}>
                {swarmStatus === "PENDING" ? (
                  <Clock className="w-4 h-4 mr-2" />
                ) : (
                  <Zap className="w-4 h-4 mr-2" />
                )}
                {vmState.buttonText}
              </Link>
            </Button>
          )}
        </div>


      </CardContent>
    </Card>
  );
}