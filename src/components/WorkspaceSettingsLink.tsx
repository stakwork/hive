"use client";

import Link from "next/link";
import { Settings } from "lucide-react";

interface WorkspaceSettingsLinkProps {
  workspaceSlug: string;
}

export function WorkspaceSettingsLink({
  workspaceSlug,
}: WorkspaceSettingsLinkProps) {
  return (
    <div className="absolute top-4 right-4">
      <Link
        href={`/workspaces/${workspaceSlug}/settings`}
        className="p-1 rounded-md hover:bg-muted"
        onClick={(e) => e.stopPropagation()}
      >
        <Settings className="w-4 h-4 text-muted-foreground hover:text-foreground" />
      </Link>
    </div>
  );
}
