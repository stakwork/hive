"use client";

import { PoolLaunchBanner } from "@/components/pool-launch-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { usePoolStatus } from "@/hooks/usePoolStatus";
import { useWorkspace } from "@/hooks/useWorkspace";
import { AlertCircle, Server, RefreshCw } from "lucide-react";
import React, { useEffect, useState, useRef } from "react";

import { CapacityControls } from "@/components/capacity/CapacityControls";
import { CapacityVisualization3D } from "@/components/capacity/CapacityVisualization3D";
import { VMGrid } from "@/components/capacity/VMGrid";
import { VMCardSkeleton } from "@/components/capacity/VMCardSkeleton";
import { VMData } from "@/types/pool-manager";

export default function CapacityPage() {
  const { workspace, slug } = useWorkspace();
  const isPoolActive = workspace?.poolState === "COMPLETE";
  const { poolStatus, error: statusError, refetch } = usePoolStatus(slug, isPoolActive);

  const [vmData, setVmData] = useState<VMData[]>([]);
  const [basicDataLoading, setBasicDataLoading] = useState(true);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'2d' | '3d'>(() => {
    const saved = localStorage.getItem("capacity-view-preference");
    return saved === "3d" ? "3d" : "2d";
  });

  // Track if metrics have been fetched to prevent infinite loop
  const metricsFetched = useRef(false);

  const handleViewChange = (mode: '2d' | '3d') => {
    setViewMode(mode);
    localStorage.setItem("capacity-view-preference", mode);
  };

  // Progressive loading: Step 1 - Fetch basic VM data from database
  useEffect(() => {
    async function fetchBasicVMData() {
      if (!slug) {
        setBasicDataLoading(false);
        return;
      }

      try {
        setBasicDataLoading(true);
        const response = await fetch(`/api/w/${slug}/pool/basic-workspaces`);

        if (!response.ok) {
          throw new Error("Failed to fetch basic VM data");
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
        setBasicDataLoading(false);
      }
    }

    if (isPoolActive) {
      fetchBasicVMData();
    } else {
      setBasicDataLoading(false);
    }
  }, [slug, isPoolActive]);

  // Reset metricsFetched ref when slug or pool status changes
  useEffect(() => {
    metricsFetched.current = false;
    setMetricsError(false);
  }, [slug, isPoolActive]);

  // Progressive loading: Step 2 - Fetch real-time metrics from pool-manager
  useEffect(() => {
    async function fetchMetrics() {
      // Prevent infinite loop - check if already fetched
      if (!slug || vmData.length === 0 || metricsFetched.current) {
        return;
      }

      try {
        setMetricsLoading(true);
        setMetricsError(false);

        const response = await fetch(`/api/w/${slug}/pool/workspaces`);

        if (!response.ok) {
          console.warn("Failed to fetch real-time metrics");
          setMetricsError(true);
          return;
        }

        const result = await response.json();

        // Only error if warning AND no workspace data was returned
        if (result.warning && (!result.data?.workspaces || result.data.workspaces.length === 0)) {
          setMetricsError(true);
        } else if (result.success && result.data) {
          setVmData(result.data.workspaces || []);
        }
      } catch (err) {
        console.warn("Failed to load real-time metrics:", err);
        setMetricsError(true);
      } finally {
        setMetricsLoading(false);
        metricsFetched.current = true;
      }
    }

    if (isPoolActive && !basicDataLoading) {
      fetchMetrics();
    }
  }, [slug, isPoolActive, basicDataLoading, vmData.length]);

  // Manual refresh handler
  const handleRefreshMetrics = async () => {
    metricsFetched.current = false;
    setMetricsError(false);
    setMetricsLoading(true);
    
    try {
      const response = await fetch(`/api/w/${slug}/pool/workspaces`);

      if (!response.ok) {
        console.warn("Failed to fetch real-time metrics");
        setMetricsError(true);
        return;
      }

      const result = await response.json();

      // Only error if warning AND no workspace data was returned
      if (result.warning && (!result.data?.workspaces || result.data.workspaces.length === 0)) {
        setMetricsError(true);
      } else if (result.success && result.data) {
        setVmData(result.data.workspaces || []);
      }
    } catch (err) {
      console.warn("Failed to load real-time metrics:", err);
      setMetricsError(true);
    } finally {
      setMetricsLoading(false);
      metricsFetched.current = true;
    }
  };

  // Pool not complete - show banner
  if (workspace?.poolState !== "COMPLETE") {
    return (
      <div className="space-y-6">
        <PageHeader title="Capacity" />
        <PoolLaunchBanner
          title="Complete Pool Setup to View Capacity"
          description="Launch your development pods to monitor resource utilization and capacity metrics."
        />
      </div>
    );
  }

  // Error state - only show if basic data failed to load
  if (error && basicDataLoading) {
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

  const queuedCountActions = poolStatus?.queuedCount ? (
    <span className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{poolStatus.queuedCount}</span> {poolStatus.queuedCount === 1 ? "task" : "tasks"} queued
    </span>
  ) : undefined;

  return (
    <div className="space-y-6">
      <PageHeader title="Capacity" actions={queuedCountActions} />

      {/* Loading skeleton while fetching basic data */}
      {basicDataLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <VMCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Show VM data once basic data is loaded */}
      {!basicDataLoading && vmData.length > 0 && (
        <>
          {/* Controls */}
          <CapacityControls
            viewMode={viewMode}
            onViewModeChange={handleViewChange}
          />

          {/* Metrics Error Banner with Retry Button */}
          {metricsError && (
            <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-lg p-3">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>Metrics unavailable</span>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={handleRefreshMetrics}
                disabled={metricsLoading}
                className="ml-auto"
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${metricsLoading ? 'animate-spin' : ''}`} /> 
                {metricsLoading ? 'Retrying...' : 'Retry'}
              </Button>
            </div>
          )}

          {/* 3D View */}
          {viewMode === '3d' && (
            <CapacityVisualization3D vmData={vmData} />
          )}

          {/* 2D View */}
          {viewMode === '2d' && (
            <VMGrid 
              vms={vmData} 
              metricsLoading={metricsLoading}
              metricsError={metricsError}
            />
          )}
        </>
      )}

      {/* Empty State */}
      {!basicDataLoading && vmData.length === 0 && (
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
