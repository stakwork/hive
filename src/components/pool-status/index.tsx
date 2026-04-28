"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/hooks/useWorkspace";
import { formatRelativeOrDate } from "@/lib/date-utils";
import { Clock, Server, Zap } from "lucide-react";
import Link from "next/link";
import { useModal } from "../modals/ModlaProvider";
import { PoolStatusResponse } from "@/types";
import { toast } from "sonner";
import { useSession } from "next-auth/react";

export function VMConfigSection() {
  const { slug, workspace } = useWorkspace();
  const open = useModal();
  const { data: session } = useSession();

  const [poolStatus, setPoolStatus] = useState<PoolStatusResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [minimumPods, setMinimumPods] = useState<number>(2);
  const [pendingPods, setPendingPods] = useState<number>(2);
  const [saving, setSaving] = useState(false);

  const isPoolActive = workspace?.poolState === "COMPLETE";
  const servicesReady = workspace?.containerFilesSetUp === true;
  const isSuperAdmin = session?.user?.isSuperAdmin ?? false;

  const fetchPoolConfig = useCallback(async () => {
    if (!slug || !isPoolActive || !isSuperAdmin) return;
    try {
      const res = await fetch(`/api/w/${slug}/pool/config`);
      const result = await res.json();
      if (result.success) {
        setMinimumPods(result.data.minimumPods);
        setPendingPods(result.data.minimumPods);
      }
    } catch {
      // Silently fail - not critical
    }
  }, [slug, isPoolActive, isSuperAdmin]);

  const fetchPoolStatus = useCallback(async () => {
    if (!slug || !isPoolActive) {
      setPoolStatus(null);
      setErrorMessage(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`/api/w/${slug}/pool/status`);

      const result = await response.json();

      if (result.success) {
        setPoolStatus(result.data);
        setErrorMessage(null);
      } else {
        setErrorMessage(result.message || "Unable to fetch pool data right now");
      }
    } catch {
      setErrorMessage("Unable to fetch pool data right now");
    } finally {
      setLoading(false);
    }
  }, [slug, isPoolActive]);

  useEffect(() => {
    fetchPoolStatus();
    fetchPoolConfig();
  }, [fetchPoolStatus, fetchPoolConfig]);

  const handleSaveMinimumPods = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/w/${slug}/pool/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minimumPods: pendingPods }),
      });
      const result = await res.json();
      if (result.success) {
        setMinimumPods(pendingPods);
        toast.success("Amount of Pods updated");
      } else {
        toast.error("Failed to update Amount of Pods");
      }
    } catch {
      toast.error("Failed to update Amount of Pods");
    } finally {
      setSaving(false);
    }
  };

  const handleOpenModal = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    open("ServicesWizard");
  };



  return (
    <Card className="relative" data-testid="vm-config-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="w-5 h-5" />
          Pool Status
        </CardTitle>
        {!isPoolActive && (
          <CardDescription>
            {servicesReady
              ? "Complete your pool setup to get started."
              : "Services are being set up."}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {isPoolActive ? (
          loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : poolStatus ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="text-green-600">
                  {poolStatus.status.usedVms} in use
                </span>
                <span className="text-muted-foreground">•</span>
                <span className="text-muted-foreground">
                  {poolStatus.status.unusedVms} available
                </span>
              </div>

              {(poolStatus.status.pendingVms > 0 || poolStatus.status.failedVms > 0) && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {poolStatus.status.pendingVms > 0 && (
                    <>
                      <span className="text-yellow-600">
                        {poolStatus.status.pendingVms} pending
                      </span>
                      {poolStatus.status.failedVms > 0 && <span>•</span>}
                    </>
                  )}
                  {poolStatus.status.failedVms > 0 && (
                    <span className="text-red-600">
                      {poolStatus.status.failedVms} failed
                    </span>
                  )}
                </div>
              )}

              {poolStatus.status.lastCheck && (
                <div className="text-xs text-muted-foreground">
                  Updated {formatRelativeOrDate(poolStatus.status.lastCheck.endsWith('Z')
                    ? poolStatus.status.lastCheck
                    : poolStatus.status.lastCheck + 'Z')}
                </div>
              )}

              {isSuperAdmin && (
                <div className="flex items-center gap-2 pt-2 border-t">
                  <Label htmlFor="minimum-vms" className="text-sm font-medium whitespace-nowrap">
                    Amount of Pods
                  </Label>
                  <Input
                    id="minimum-vms"
                    type="number"
                    min={1}
                    value={pendingPods}
                    onChange={(e) => setPendingPods(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-20 h-8"
                    disabled={saving}
                  />
                  <Button
                    size="sm"
                    onClick={handleSaveMinimumPods}
                    disabled={saving || pendingPods === minimumPods}
                  >
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </div>
              )}
            </div>
          ) : errorMessage ? (
            <div className="text-sm text-muted-foreground">
              {errorMessage}
            </div>
          ) : null
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {!servicesReady ? (
              <div className="flex items-center gap-3">
                <div className="relative flex items-center justify-center w-12 h-12 rounded-full bg-orange-100 text-orange-700">
                  <Clock className="w-6 h-6" />
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full animate-pulse" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">In progress</span>
                </div>
              </div>
            ) : (
              <Button asChild>
                <Link onClick={handleOpenModal} href={`/w/${slug}`}>
                  <Zap className="w-4 h-4 mr-2" />
                  Launch Pods
                </Link>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
