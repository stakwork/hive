"use client";

import { McpServersSettings } from "./McpServersSettings";

interface OrgSettingsViewProps {
  githubLogin: string;
}

/**
 * Org-level settings. Renders inside OrgShell's centered container
 * (non-full-bleed). Currently hosts the external MCP server registry
 * for the org canvas agent; future org-wide settings cards slot in
 * below.
 */
export function OrgSettingsView({ githubLogin }: OrgSettingsViewProps) {
  return (
    <div className="space-y-6">
      <McpServersSettings githubLogin={githubLogin} />
    </div>
  );
}
