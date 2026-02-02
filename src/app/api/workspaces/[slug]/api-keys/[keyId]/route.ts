import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getApiKey, revokeApiKey } from "@/lib/api-keys";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * DELETE /api/workspaces/[slug]/api-keys/[keyId]
 * Revoke an API key
 *
 * Permissions:
 * - OWNER, ADMIN: Can revoke any key in the workspace
 * - PM, DEVELOPER: Can only revoke keys they created
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; keyId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug, keyId } = await params;
    const userId = (session.user as { id: string }).id;

    // Check workspace access - need write permission at minimum
    const access = await validateWorkspaceAccess(slug, userId);
    if (!access.hasAccess || !access.canWrite) {
      return NextResponse.json(
        { error: "Forbidden - write access required" },
        { status: 403 }
      );
    }

    if (!access.workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    // Get the API key to check ownership and workspace
    const apiKey = await getApiKey(keyId);
    if (!apiKey) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    // Verify the key belongs to this workspace
    if (apiKey.workspaceId !== access.workspace.id) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    // Check if already revoked
    if (apiKey.revokedAt) {
      return NextResponse.json(
        { error: "API key already revoked" },
        { status: 400 }
      );
    }

    // Permission check: Admins can revoke any key, others can only revoke their own
    if (!access.canAdmin && apiKey.createdById !== userId) {
      return NextResponse.json(
        { error: "Forbidden - can only revoke your own keys" },
        { status: 403 }
      );
    }

    // Revoke the key
    const success = await revokeApiKey({
      keyId,
      revokedById: userId,
    });

    if (!success) {
      return NextResponse.json(
        { error: "Failed to revoke API key" },
        { status: 500 }
      );
    }

    logger.info("API key revoked", "API_KEYS", {
      workspaceId: access.workspace.id,
      keyId,
      revokedById: userId,
    });

    return NextResponse.json({
      success: true,
      message: "API key revoked",
    });
  } catch (error) {
    logger.error("Error revoking API key", "API_KEYS", { error });
    return NextResponse.json(
      { error: "Failed to revoke API key" },
      { status: 500 }
    );
  }
}
