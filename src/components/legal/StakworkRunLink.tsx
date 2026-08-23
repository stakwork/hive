"use client";

import { ExternalLink } from "lucide-react";

interface StakworkRunLinkProps {
  projectId: number | null | undefined;
  isSuperAdmin: boolean;
  /** When true, shows the link to all workspace members (not just super admins).
   *  Defaults to false — all existing call-sites are unaffected. */
  showForAll?: boolean;
}

export function StakworkRunLink({ projectId, isSuperAdmin, showForAll }: StakworkRunLinkProps) {
  if ((!isSuperAdmin && !showForAll) || projectId == null) return null;
  return (
    <a
      href={`https://jobs.stakwork.com/admin/projects/${projectId}`}
      title="View on Stakwork (admin)"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <ExternalLink className="h-3.5 w-3.5" />
      View on Stakwork
    </a>
  );
}
