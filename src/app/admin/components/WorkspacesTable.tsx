"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Building2, ChevronUp, ChevronDown } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PresignedImage } from "@/components/ui/presigned-image";

type SortField = "name" | "members" | "pods" | "tasks" | "createdAt";
type SortDirection = "asc" | "desc";

interface WorkspaceData {
  id: string;
  name: string;
  slug: string;
  logoKey: string | null;
  createdAt: Date;
  _count: {
    members: number;
    tasks: number;
  };
  swarm: {
    _count: {
      pods: number;
    };
  } | null;
}

interface WorkspacesTableProps {
  workspaces: WorkspaceData[];
}

export function WorkspacesTable({ workspaces }: WorkspacesTableProps) {
  const [sortState, setSortState] = useState<{ field: SortField; direction: SortDirection }>({
    field: "createdAt",
    direction: "desc",
  });
  const [logoUrls, setLogoUrls] = useState<Record<string, string>>({});

  // Fetch logos on mount for workspaces that have logoKey
  useEffect(() => {
    const fetchLogos = async () => {
      const workspacesWithLogos = workspaces.filter((ws) => ws.logoKey);
      
      const logoPromises = workspacesWithLogos.map(async (workspace) => {
        try {
          const response = await fetch(`/api/workspaces/${workspace.slug}/image`);
          if (response.ok) {
            const data = await response.json();
            return { slug: workspace.slug, url: data.url };
          }
        } catch (error) {
          console.error(`Failed to fetch logo for ${workspace.slug}:`, error);
        }
        return null;
      });

      const results = await Promise.all(logoPromises);
      const newLogoUrls: Record<string, string> = {};
      
      results.forEach((result) => {
        if (result) {
          newLogoUrls[result.slug] = result.url;
        }
      });

      setLogoUrls(newLogoUrls);
    };

    fetchLogos();
  }, [workspaces]);

  const handleSort = (field: SortField) => {
    setSortState((prev) => {
      if (prev.field === field) {
        // Toggle direction if clicking the same field
        const newState = { field, direction: prev.direction === "asc" ? "desc" : "asc" as SortDirection };
        return newState;
      } else {
        // Default to ascending when switching fields
        const newState = { field, direction: "asc" as SortDirection };
        return newState;
      }
    });
  };

  const sortedWorkspaces = [...workspaces].sort((a, b) => {
    let comparison = 0;

    switch (sortState.field) {
      case "name":
        comparison = a.name.localeCompare(b.name);
        break;
      case "members":
        comparison = (a._count.members + 1) - (b._count.members + 1);
        break;
      case "pods":
        const podsA = a.swarm?._count.pods ?? 0;
        const podsB = b.swarm?._count.pods ?? 0;
        comparison = podsA - podsB;
        break;
      case "tasks":
        comparison = a._count.tasks - b._count.tasks;
        break;
      case "createdAt":
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
    }

    return sortState.direction === "asc" ? comparison : -comparison;
  });

  const refetchLogo = async (slug: string): Promise<string | null> => {
    try {
      const response = await fetch(`/api/workspaces/${slug}/image`);
      if (response.ok) {
        const data = await response.json();
        setLogoUrls((prev) => ({ ...prev, [slug]: data.url }));
        return data.url;
      }
      return null;
    } catch (error) {
      console.error("Failed to fetch logo:", error);
      return null;
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortState.field !== field) return null;
    return sortState.direction === "asc" ? (
      <ChevronUp className="inline w-4 h-4 ml-1" />
    ) : (
      <ChevronDown className="inline w-4 h-4 ml-1" />
    );
  };

  const SortableHeader = ({
    field,
    children,
  }: {
    field: SortField;
    children: React.ReactNode;
  }) => (
    <TableHead
      className="cursor-pointer select-none hover:bg-muted/50"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center">
        {children}
        <SortIcon field={field} />
      </div>
    </TableHead>
  );

  if (workspaces.length === 0) {
    return <p className="text-muted-foreground">No workspaces found</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[60px]">Icon</TableHead>
          <SortableHeader field="name">Name</SortableHeader>
          <TableHead>Slug</TableHead>
          <SortableHeader field="members">Members</SortableHeader>
          <SortableHeader field="pods">Pods</SortableHeader>
          <SortableHeader field="tasks">Tasks</SortableHeader>
          <SortableHeader field="createdAt">Created</SortableHeader>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedWorkspaces.map((workspace) => (
          <TableRow key={workspace.id}>
            <TableCell>
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted">
                {workspace.logoKey ? (
                  <PresignedImage
                    src={logoUrls[workspace.slug]}
                    alt={workspace.name}
                    className="w-full h-full object-cover rounded-lg"
                    onRefetchUrl={() => refetchLogo(workspace.slug)}
                    fallback={<Building2 className="w-4 h-4" />}
                  />
                ) : (
                  <Building2 className="w-4 h-4" />
                )}
              </div>
            </TableCell>
            <TableCell className="font-medium">{workspace.name}</TableCell>
            <TableCell>
              <code className="text-xs">{workspace.slug}</code>
            </TableCell>
            <TableCell>{workspace._count.members + 1}</TableCell>
            <TableCell>{workspace.swarm?._count.pods ?? 0}</TableCell>
            <TableCell>{workspace._count.tasks}</TableCell>
            <TableCell>
              {new Date(workspace.createdAt).toLocaleDateString()}
            </TableCell>
            <TableCell>
              <Link
                href={`/w/${workspace.slug}/settings`}
                className="text-sm text-primary hover:underline"
              >
                Settings →
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
