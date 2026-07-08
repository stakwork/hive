"use client";

import { ExternalLink } from "lucide-react";

interface StakworkRunLinkProps {
  projectId: number | null | undefined;
  isSuperAdmin: boolean;
}

export function StakworkRunLink({ projectId, isSuperAdmin }: StakworkRunLinkProps) {
  if (!isSuperAdmin || projectId == null) return null;
  return (
    <a
      href={`https://jobs.stakwork.com/admin/projects/${projectId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <ExternalLink className="h-3.5 w-3.5" />
      View on Stakwork
    </a>
  );
}
