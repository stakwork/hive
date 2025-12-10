"use client";

import { PageHeader } from "@/components/ui/page-header";
import { ConnectRepository } from "@/components/ConnectRepository";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePoolStatus } from "@/hooks/usePoolStatus";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, AlertCircle, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";

import { VMData } from "@/types/pool-manager";
import { CapacityVisualization3D } from "@/components/capacity/CapacityVisualization3D";
import { CapacityControls } from "@/components/capacity/CapacityControls";
import { VMGrid } from "@/components/capacity/VMGrid";

export default function CapacityPage() {
  const { workspace, slug } = useWorkspace();
  const isPoolActive = workspace?.poolState === "COMPLETE";
  const { poolStatus, loading: statusLoading, error: statusError, refetch } = usePoolStatus(slug, isPoolActive);

  const [vmData, setVmData] = useState<VMData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'2d' | '3d'>(() => {
    const saved = localStorage.getItem("capacity-view-preference");
    return saved === "3d" ? "3d" : "2d";
  });

  const handleViewChange = (mode: '2d' | '3d') => {
    setViewMode(mode);
    localStorage.setItem("capacity-view-preference", mode);
  };

  // Fetch VM details from internal API
  useEffect(() => {
    async function fetchVMData() {
      if (!slug) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const response = await fetch(`/api/w/${slug}/pool/workspaces`);

        if (!response.ok) {
          throw new Error("Failed to fetch VM data");
        }

        const result = await response.json();

        if (result.success && result.data) {
          setVmData(result.data.workspaces || []);
        } else {
          throw new Error(result.message || "Failed to load VM details");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load VM details");
      } finally {
        setLoading(false);
      }
    }

    if (isPoolActive) {
      fetchVMData();
    } else {
      setLoading(false);
    }
  }, [slug, isPoolActive]);

  // Not set up yet
  if (!workspace || !workspace.repositories?.length) {
    return (
      <div className="space-y-6">
        <PageHeader title="Capacity" />
        <ConnectRepository
          workspaceSlug={slug}
          title="Connect repository to view capacity"
          description="Setup your development environment to monitor resource capacity."
          buttonText="Connect Repository"
        />
      </div>
    );
  }

  // Pool not active
  if (!isPoolActive) {
    return (
      <div className="space-y-6">
        <PageHeader title="Capacity" />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              No Active Pool
            </CardTitle>
            <CardDescription>
              Resource pool is not configured or not active yet.
              Please configure your pool in workspace settings to view capacity metrics.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Loading
  if (statusLoading || loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Capacity" />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Error
  if (statusError || error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Capacity" />
        <Card>
          <CardContent className="py-12">
            <div className="text-center space-y-4">
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto" />
              <div>
                <p className="text-red-600 font-medium">Error loading capacity data</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {statusError || error}
                </p>
              </div>
              <Button onClick={refetch} variant="outline">
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Capacity" />

      {vmData.length > 0 && (
        <>
          {/* Controls */}
          <CapacityControls
            viewMode={viewMode}
            onViewModeChange={handleViewChange}
          />

          {/* 3D View */}
          {viewMode === '3d' && (
            <CapacityVisualization3D vmData={vmData} />
          )}

          {/* 2D View */}
          {viewMode === '2d' && (
            <VMGrid vms={vmData} />
          )}
        </>
      )}

      {/* Empty State */}
      {vmData.length === 0 && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No pods found in this pool</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
