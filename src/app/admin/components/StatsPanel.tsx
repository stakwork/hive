"use client";

import React, { useState, useEffect } from "react";
import {
  CheckCircle2,
  CircleDot,
  PlusCircle,
  GitMerge,
  Server,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";

interface Stats {
  tasksCompleted: number;
  tasksInProgress: number;
  tasksCreated: number;
  prsMerged: number;
  activePods: number;
  totalUsers: number;
}

export function StatsPanel() {
  const [timeWindow, setTimeWindow] = useState<string>("all");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/admin/stats?window=${timeWindow}`);
        if (response.ok) {
          const data = await response.json();
          setStats(data);
        }
      } catch (error) {
        console.error("Error fetching stats:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [timeWindow]);

  const statCards = [
    {
      title: "Tasks Completed",
      value: stats?.tasksCompleted,
      icon: CheckCircle2,
      isStatic: false,
    },
    {
      title: "Tasks In Progress",
      value: stats?.tasksInProgress,
      icon: CircleDot,
      isStatic: false,
    },
    {
      title: "Tasks Created",
      value: stats?.tasksCreated,
      icon: PlusCircle,
      isStatic: false,
    },
    {
      title: "PRs Merged",
      value: stats?.prsMerged,
      icon: GitMerge,
      isStatic: false,
    },
    {
      title: "Active Pods",
      value: stats?.activePods,
      icon: Server,
      isStatic: true,
    },
    {
      title: "Total Users",
      value: stats?.totalUsers,
      icon: Users,
      isStatic: true,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Platform Statistics</h3>
        <ToggleGroup
          type="single"
          value={timeWindow}
          onValueChange={(value) => {
            if (value) setTimeWindow(value);
          }}
        >
          <ToggleGroupItem value="all" aria-label="All time">
            All-time
          </ToggleGroupItem>
          <ToggleGroupItem value="24h" aria-label="Last 24 hours">
            24h
          </ToggleGroupItem>
          <ToggleGroupItem value="7d" aria-label="Last 7 days">
            7d
          </ToggleGroupItem>
          <ToggleGroupItem value="30d" aria-label="Last 30 days">
            30d
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {card.title}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div>
                    <div className="text-2xl font-bold">
                      {card.value ?? 0}
                    </div>
                    {card.isStatic && (
                      <p className="text-xs text-muted-foreground mt-1">
                        All-time
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
