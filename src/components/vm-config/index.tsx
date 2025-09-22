"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/hooks/useWorkspace";
import { cn } from "@/lib/utils";
import { CheckCircle, Clock, MoreHorizontal, Server, Settings, Zap } from "lucide-react";
import Link from "next/link";
import { useModal } from "../modals/ModlaProvider";

export function VMConfigSection() {
  const { slug, workspace } = useWorkspace();

  const open = useModal();
  console.log(workspace);
  // const swarmStatus = workspace?.swarmStatus;

  const poolState = workspace?.poolState;
  const poolStateCompleted = workspace?.poolState === "COMPLETE";

  console.log(poolStateCompleted);

  // Check if we should show the modal

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
                      <Clock className="w-6 h-6" />
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full animate-pulse" />
                    </>
                  )}
                </div>
                <div>
                  <span className="text-sm font-medium">{vmState.statusBadge.text}</span>
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
              <Link onClick={handleOpenModal} href={slug ? vmState.buttonHref : "#"}>
                <Zap className="w-4 h-4 mr-2" />
                {vmState.buttonText}
              </Link>
            </Button>
          )}
        </div>


      </CardContent>
    </Card>
  );
}