"use client";

import React, { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

type PRWindowKey = "24h" | "48h" | "1w" | "2w" | "1mo";

interface WindowStat {
  hiveCount: number;
  githubTotal: number | null;
  percentage: number | null;
}

interface RepoStats {
  repoUrl: string;
  repoName: string;
  windows: Record<PRWindowKey, WindowStat>;
}

interface PRStatsResponse {
  repos: RepoStats[];
  totals: {
    windows: Record<PRWindowKey, WindowStat>;
  };
}

interface WorkspacePRStatsProps {
  workspaceId: string;
}

const WINDOWS: { key: PRWindowKey; label: string }[] = [
  { key: "24h", label: "24h" },
  { key: "48h", label: "48h" },
  { key: "1w", label: "1 week" },
  { key: "2w", label: "2 weeks" },
  { key: "1mo", label: "1 month" },
];

function formatCell(stat: WindowStat): string {
  if (stat.githubTotal === null) {
    return `${stat.hiveCount} / —`;
  }
  if (stat.percentage !== null) {
    return `${stat.hiveCount} / ${stat.githubTotal} (${stat.percentage}%)`;
  }
  return `${stat.hiveCount} / ${stat.githubTotal}`;
}

export default function WorkspacePRStats({ workspaceId }: WorkspacePRStatsProps) {
  const [data, setData] = useState<PRStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch(`/api/admin/workspaces/${workspaceId}/pr-stats`);
        if (!response.ok) throw new Error("Failed to fetch");
        const json = await response.json();
        setData(json);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [workspaceId]);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="text-sm text-muted-foreground">Failed to load PR statistics.</p>
    );
  }

  const showTotals = data.repos.length > 1;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Repo</TableHead>
          {WINDOWS.map(({ key, label }) => (
            <TableHead key={key}>{label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.repos.map((repo) => (
          <TableRow key={repo.repoUrl}>
            <TableCell className="font-medium">{repo.repoName}</TableCell>
            {WINDOWS.map(({ key }) => (
              <TableCell key={key}>{formatCell(repo.windows[key])}</TableCell>
            ))}
          </TableRow>
        ))}
        {showTotals && (
          <TableRow>
            <TableCell className="font-bold">Total</TableCell>
            {WINDOWS.map(({ key }) => (
              <TableCell key={key} className="font-bold">
                {formatCell(data.totals.windows[key])}
              </TableCell>
            ))}
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
