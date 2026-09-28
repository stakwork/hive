/**
 * The one gate every OpenHealth Benchmarks route passes: the slug list
 * first, then membership. A workspace that is not on the list, and a caller
 * who is not a member of one that is, get the same 404.
 */

import { NextRequest, NextResponse } from "next/server";
import { WorkspaceRole } from "@/lib/auth/roles";
import { resolveWorkspaceAccess, type WorkspaceAccess } from "@/lib/auth/workspace-access";
import { WORKSPACE_PERMISSION_LEVELS } from "@/lib/constants";
import { OPENHEALTH_SLUGS } from "@/lib/eval-capture-slugs";

export type OpenHealthMember = Extract<WorkspaceAccess, { kind: "member" }>;

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function authorizeOpenHealth(
  request: NextRequest,
  slug: string,
  opts: { launch?: boolean } = {},
): Promise<OpenHealthMember | NextResponse> {
  if (!OPENHEALTH_SLUGS.includes(slug)) return notFound();
  const access = await resolveWorkspaceAccess(request, { slug });
  if (access.kind === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (access.kind !== "member") return notFound();
  // Launching and cancelling spend money on the workspace's swarm.
  if (
    opts.launch &&
    WORKSPACE_PERMISSION_LEVELS[access.role] < WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.DEVELOPER]
  ) {
    return NextResponse.json({ error: "Developer access required" }, { status: 403 });
  }
  return access;
}
