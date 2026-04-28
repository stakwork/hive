"use client";

import { DashboardChat } from "@/components/dashboard/DashboardChat";

interface OrgChatProps {
  workspaceSlugs: string[];
  githubLogin: string;
  orgId?: string;
  /**
   * Current canvas scope the user is viewing. `""` is the org root,
   * `"initiative:<id>"` / `"ws:<id>"` etc. for sub-canvases. Threaded
   * to the agent so tool calls default to this ref.
   */
  currentCanvasRef?: string;
  /**
   * Human-readable breadcrumb for the current canvas — e.g. `"Acme"`
   * on root, `"Acme › Auth Refactor"` on a sub-canvas. Lets the agent
   * refer to the scope by name in replies instead of by ref id.
   */
  currentCanvasBreadcrumb?: string;
  /**
   * Live id of the canvas node the user has selected (e.g.
   * `"initiative:abc"`), or null when nothing is selected. Lets the
   * agent resolve "this" / "here" references without guessing.
   */
  selectedNodeId?: string | null;
}

export function OrgChat({
  workspaceSlugs,
  githubLogin,
  orgId,
  currentCanvasRef,
  currentCanvasBreadcrumb,
  selectedNodeId,
}: OrgChatProps) {
  return (
    <DashboardChat
      defaultExtraWorkspaceSlugs={workspaceSlugs}
      orgSlug={githubLogin}
      orgId={orgId}
      maxExtraWorkspaces={Number.POSITIVE_INFINITY}
      currentCanvasRef={currentCanvasRef}
      currentCanvasBreadcrumb={currentCanvasBreadcrumb}
      selectedNodeId={selectedNodeId}
    />
  );
}
