import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Circle, MoreVertical, Copy, ExternalLink, Globe, Trash2, Loader2, User } from "lucide-react";
import { VMData } from "@/types/pool-manager";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import Link from "next/link";
import React, { useState } from "react";

interface VMGridProps {
  vms: VMData[];
  metricsLoading?: boolean;
  metricsError?: boolean;
  isAdmin?: boolean;
  onDeletePod?: (vm: VMData) => void;
  workspaceSlug?: string;
  currentPath?: string;
}

function getStatusIndicator(state: string, usage_status: string) {
  if (state === "running" && usage_status === "used") {
    return <Circle className="h-2 w-2 fill-green-500 text-green-500" />;
  }
  if (state === "pending") {
    return <Circle className="h-2 w-2 fill-yellow-500 text-yellow-500" />;
  }
  if (state === "failed") {
    return <Circle className="h-2 w-2 fill-red-500 text-red-500" />;
  }
  return <Circle className="h-2 w-2 fill-muted-foreground text-muted-foreground" />;
}

function VMCard({
  vm,
  metricsLoading,
  metricsError,
  isAdmin,
  onDeletePod,
  workspaceSlug,
  currentPath,
}: {
  vm: VMData;
  metricsLoading?: boolean;
  metricsError?: boolean;
  isAdmin?: boolean;
  onDeletePod?: (vm: VMData) => void;
  workspaceSlug?: string;
  currentPath?: string;
}) {
  const [copySuccess, setCopySuccess] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const cpuPercent = vm.resource_usage.available
    ? (parseFloat(vm.resource_usage.usage.cpu) / parseFloat(vm.resource_usage.requests.cpu)) * 100
    : 0;
  const memoryPercent = vm.resource_usage.available
    ? (parseFloat(vm.resource_usage.usage.memory) / parseFloat(vm.resource_usage.requests.memory)) * 100
    : 0;

  const isHighUsage = cpuPercent > 70 || memoryPercent > 70;

  const handleCopyPassword = async () => {
    if (!vm.password) return;

    try {
      await navigator.clipboard.writeText(vm.password);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error("Failed to copy password:", err);
    }
  };

  const [isOpeningBrowser, setIsOpeningBrowser] = useState(false);

  const handleOpenIDE = () => {
    if (!vm.url) return;
    window.open(vm.url, "_blank", "noopener,noreferrer");
  };

  const handleOpenBrowser = async () => {
    if (!workspaceSlug || !vm.id || isOpeningBrowser) return;

    // Open a blank tab synchronously so the popup blocker treats it as
    // user-initiated. We'll set its location once the URL is resolved.
    const newWindow = window.open("about:blank", "_blank", "noopener,noreferrer");
    setIsOpeningBrowser(true);

    try {
      const res = await fetch(
        `/api/w/${encodeURIComponent(workspaceSlug)}/pool/${encodeURIComponent(vm.id)}/frontend-url`,
      );
      const json = await res.json().catch(() => null);
      const url = json?.data?.frontendUrl as string | undefined;

      if (url && newWindow) {
        newWindow.location.href = url;
      } else if (url) {
        // Popup blocked — try a fresh window.open as a fallback.
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        newWindow?.close();
        console.error("Failed to resolve frontend URL", json);
      }
    } catch (err) {
      newWindow?.close();
      console.error("Failed to resolve frontend URL", err);
    } finally {
      setIsOpeningBrowser(false);
    }
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {getStatusIndicator(vm.state, vm.usage_status)}
            <span className="font-mono text-sm font-medium truncate">{vm.subdomain}</span>
          </div>
          <div className="flex items-center gap-2">
            {vm.state === "pending" && (
              <Badge variant="outline" className="text-xs">Pending</Badge>
            )}
            {vm.password && vm.url && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleCopyPassword}>
                    <Copy className="h-4 w-4 mr-2" />
                    {copySuccess ? "Copied!" : "Copy password"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleOpenIDE}>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open IDE
                  </DropdownMenuItem>
                  {workspaceSlug && (
                    <DropdownMenuItem
                      onClick={handleOpenBrowser}
                      disabled={isOpeningBrowser}
                      onSelect={(e) => {
                        // Keep the menu logic simple; default close-on-select is fine.
                        if (isOpeningBrowser) e.preventDefault();
                      }}
                    >
                      {isOpeningBrowser ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Globe className="h-4 w-4 mr-2" />
                      )}
                      {isOpeningBrowser ? "Opening..." : "Open Browser"}
                    </DropdownMenuItem>
                  )}
                  {isAdmin && onDeletePod && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        disabled={isDeleting}
                        onClick={async () => {
                          setIsDeleting(true);
                          await onDeletePod(vm);
                          setIsDeleting(false);
                        }}
                      >
                        {isDeleting ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 mr-2" />
                        )}
                        Delete pod
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* User or Pending Message */}
        {vm.state === "pending" ? (
          <p className="text-xs text-muted-foreground">Preparing your environment...</p>
        ) : vm.usage_status === "used" && vm.assignedTask ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <Avatar className="size-5 flex-shrink-0">
              <AvatarImage src={vm.assignedTask.creator.image || undefined} />
              <AvatarFallback className="text-xs">
                <User className="w-3 h-3" />
              </AvatarFallback>
            </Avatar>
            {workspaceSlug ? (
              <Link
                href={`/w/${workspaceSlug}/task/${vm.assignedTask.id}${currentPath ? `?from=${encodeURIComponent(currentPath)}` : ""}`}
                className="text-xs text-muted-foreground truncate hover:underline"
              >
                {vm.assignedTask.title}
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground truncate">
                {vm.assignedTask.title}
              </span>
            )}
          </div>
        ) : null}

        {/* Resources */}
        {vm.resource_usage.available ? (
          <div className="space-y-2 pt-1">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">CPU</span>
                <span className={`font-medium tabular-nums ${isHighUsage && cpuPercent > 70 ? 'text-amber-600' : ''}`}>
                  {cpuPercent.toFixed(1)}%
                </span>
              </div>
              <div className="h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    cpuPercent > 70 ? 'bg-amber-500' : 'bg-primary'
                  }`}
                  style={{ width: `${Math.min(cpuPercent, 100)}%` }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Memory</span>
                <span className={`font-medium tabular-nums ${isHighUsage && memoryPercent > 70 ? 'text-amber-600' : ''}`}>
                  {memoryPercent.toFixed(1)}%
                </span>
              </div>
              <div className="h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    memoryPercent > 70 ? 'bg-amber-500' : 'bg-primary'
                  }`}
                  style={{ width: `${Math.min(memoryPercent, 100)}%` }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2 pt-1">
            {metricsLoading && !metricsError && (
              <p className="text-xs text-muted-foreground italic">Fetching metrics...</p>
            )}
            {metricsError && (
              <p className="text-xs text-muted-foreground italic">Metrics unavailable</p>
            )}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">CPU</span>
              </div>
              <Skeleton className="h-1 w-full rounded-full" />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Memory</span>
              </div>
              <Skeleton className="h-1 w-full rounded-full" />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function VMGrid({ vms, metricsLoading, metricsError, isAdmin, onDeletePod, workspaceSlug, currentPath }: VMGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
      {vms.map((vm) => (
        <VMCard
          key={vm.id}
          vm={vm}
          metricsLoading={metricsLoading}
          metricsError={metricsError}
          isAdmin={isAdmin}
          onDeletePod={onDeletePod}
          workspaceSlug={workspaceSlug}
          currentPath={currentPath}
        />
      ))}
    </div>
  );
}
