"use client";

import { ExternalLink } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { strutRunDeepLink, workspaceStrutViewPath } from "@/lib/utils/strut-links";

/** The workspace's strut view (`/w/<slug>/strut`) opens for its Owners and Admins only. */
export function useCanOpenStrutView(): boolean {
  const { isOwner, isAdmin } = useWorkspace();
  return isOwner || isAdmin;
}

interface StrutRunViewLinkProps {
  strutRunId?: string | null;
  workflow?: string | null;
  /** Just the icon, for a table cell. */
  iconOnly?: boolean;
}

/**
 * A strut legal run opened in the workspace's own strut view, at the run's
 * deep link: the strut twin of StakworkRunLink. Renders nothing for a
 * viewer the strut view would refuse, or a run strut has not named yet.
 */
export function StrutRunViewLink({ strutRunId, workflow, iconOnly = false }: StrutRunViewLinkProps) {
  const { workspace } = useWorkspace();
  const canOpen = useCanOpenStrutView();
  if (!canOpen || !workspace?.slug || !strutRunId || !workflow) return null;
  return (
    <a
      href={workspaceStrutViewPath(workspace.slug, strutRunDeepLink(workflow, strutRunId))}
      title="Open in strut"
      aria-label={iconOnly ? "Open in strut" : undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      data-testid="strut-run-view-link"
    >
      <ExternalLink className={iconOnly ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {!iconOnly && "Open in strut"}
    </a>
  );
}
