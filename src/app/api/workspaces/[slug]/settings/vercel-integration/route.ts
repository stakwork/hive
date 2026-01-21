import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { validateWorkspaceAccess } from "@/services/workspace";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { z } from "zod";

const encryptionService = EncryptionService.getInstance();

// Validation schema for PUT request
const vercelIntegrationSchema = z.object({
  vercelApiToken: z.string().min(1, "Vercel API token is required").optional().nullable(),
  vercelTeamId: z.string().optional().nullable(),
});

/**
 * GET /api/workspaces/[slug]/settings/vercel-integration
 * Returns the workspace's Vercel integration settings (decrypted token, team ID, webhook URL)
 * Requires Admin or Owner role
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 },
      );
    }

    // Validate workspace access and check for admin permissions
    const access = await validateWorkspaceAccess(slug, userId);

    if (!access.hasAccess) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    if (!access.canAdmin) {
      return NextResponse.json(
        { error: "Only workspace owners and admins can access Vercel integration settings" },
        { status: 403 },
      );
    }

    // Fetch workspace with Vercel integration fields
    const workspace = await db.workspace.findUnique({
      where: { slug, deleted: false },
      select: {
        id: true,
        vercelApiToken: true,
        vercelTeamId: true,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      );
    }

    // Decrypt the API token if it exists
    let decryptedToken: string | null = null;
    if (workspace.vercelApiToken) {
      try {
        decryptedToken = encryptionService.decryptField(
          "vercelApiToken",
          workspace.vercelApiToken,
        );
      } catch (error) {
        console.error("Error decrypting Vercel API token:", error);
        // Return null if decryption fails (token might be corrupted)
        decryptedToken = null;
      }
    }

    // Generate webhook URL
    const webhookUrl = `${process.env.NEXTAUTH_URL}/api/workspaces/${slug}/webhooks/vercel`;

    return NextResponse.json({
      vercelApiToken: decryptedToken,
      vercelTeamId: workspace.vercelTeamId,
      webhookUrl,
    });
  } catch (error) {
    console.error("Error fetching Vercel integration settings:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/workspaces/[slug]/settings/vercel-integration
 * Updates the workspace's Vercel integration settings
 * Encrypts the API token before storage
 * Requires Admin or Owner role
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 },
      );
    }

    // Validate workspace access and check for admin permissions
    const access = await validateWorkspaceAccess(slug, userId);

    if (!access.hasAccess) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    if (!access.canAdmin) {
      return NextResponse.json(
        { error: "Only workspace owners and admins can update Vercel integration settings" },
        { status: 403 },
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validatedData = vercelIntegrationSchema.parse(body);

    // Encrypt the API token if provided
    let encryptedToken: string | null = null;
    if (validatedData.vercelApiToken) {
      try {
        const encrypted = encryptionService.encryptField(
          "vercelApiToken",
          validatedData.vercelApiToken,
        );
        encryptedToken = JSON.stringify(encrypted);
      } catch (error) {
        console.error("Error encrypting Vercel API token:", error);
        return NextResponse.json(
          { error: "Failed to encrypt API token" },
          { status: 500 },
        );
      }
    }

    // Update the workspace
    const updatedWorkspace = await db.workspace.update({
      where: { slug, deleted: false },
      data: {
        vercelApiToken: encryptedToken,
        vercelTeamId: validatedData.vercelTeamId,
      },
      select: {
        id: true,
        vercelTeamId: true,
      },
    });

    // Generate webhook URL for response
    const webhookUrl = `${process.env.NEXTAUTH_URL}/api/workspaces/${slug}/webhooks/vercel`;

    return NextResponse.json({
      success: true,
      vercelTeamId: updatedWorkspace.vercelTeamId,
      webhookUrl,
    });
  } catch (error) {
    console.error("Error updating Vercel integration settings:", error);

    // Handle validation errors
    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 },
      );
    }

    const message =
      error instanceof Error ? error.message : "Internal server error";

    let status = 500;
    if (error instanceof Error) {
      if (
        error.message.includes("not found") ||
        error.message.includes("access denied")
      ) {
        status = 404;
      } else if (
        error.message.includes("Only workspace owners") ||
        error.message.includes("owners and admins") ||
        error.message.includes("insufficient permissions") ||
        error.message.toLowerCase().includes("forbidden")
      ) {
        status = 403;
      }
    }

    return NextResponse.json({ error: message }, { status });
  }
}
