/**
 * Shared resolution for the Graph Explorer's Jarvis-backed routes.
 *
 * Every `/api/workspaces/[slug]/graph/*` route that talks to Jarvis needs the
 * same three things: an authenticated session, the admin gate the Graph
 * Explorer page enforces, and the workspace's decrypted swarm credentials.
 * Returning a `NextResponse` for the failure cases keeps each route's happy
 * path flat.
 */

import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

export interface JarvisAccess {
  /** Jarvis knowledge-graph base URL (`:8444`) — NOT the stakgraph base. */
  jarvisUrl: string;
  apiKey: string;
}

/**
 * Resolve Jarvis credentials for a workspace, or the `NextResponse` explaining
 * why not. Callers do:
 *
 *   const access = await resolveJarvisAccess(slug);
 *   if (access instanceof NextResponse) return access;
 */
export async function resolveJarvisAccess(slug: string): Promise<JarvisAccess | NextResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id?: string })?.id;
  if (!userId) {
    return NextResponse.json({ success: false, message: "Invalid user session" }, { status: 401 });
  }

  // Validate workspace access (IDOR guard — must happen before resolving swarm)
  const access = await validateWorkspaceAccess(slug, userId, true);
  if (!access.hasAccess) {
    return NextResponse.json(
      { success: false, message: "Workspace not found or access denied" },
      { status: 404 },
    );
  }

  // Role gate — admins and owners only
  if (!access.canAdmin) {
    return NextResponse.json(
      { success: false, message: "Forbidden: admin access required" },
      { status: 403 },
    );
  }

  const workspace = await db.workspace.findFirst({
    where: { slug, deleted: false },
    select: { id: true },
  });

  if (!workspace) {
    return NextResponse.json({ success: false, message: "Workspace not found" }, { status: 404 });
  }

  const swarm = await db.swarm.findUnique({ where: { workspaceId: workspace.id } });

  if (!swarm?.name || !swarm.swarmApiKey) {
    return NextResponse.json(
      { success: false, message: "Graph DB not configured for this workspace" },
      { status: 400 },
    );
  }

  const encryptionService = EncryptionService.getInstance();
  let apiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);

  if (process.env.CUSTOM_SWARM_API_KEY) {
    apiKey = process.env.CUSTOM_SWARM_API_KEY;
  }

  return { jarvisUrl: getJarvisUrl(swarm.name), apiKey };
}
