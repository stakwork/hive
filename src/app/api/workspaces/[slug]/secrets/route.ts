import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { stakworkService } from "@/lib/service-factory";
import { validateWorkspaceAccess } from "@/services/workspace";
import { checkIsSuperAdmin } from "@/lib/middleware/utils";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const encryptionService = EncryptionService.getInstance();

/**
 * GET /api/workspaces/[slug]/secrets
 * List all secrets for a workspace (values never returned)
 * Permissions: ADMIN+
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const userId = (session.user as { id: string }).id;

    // Deny-then-elevate: first attempt uses normal membership check;
    // checkIsSuperAdmin only runs when that fails.
    let access = await validateWorkspaceAccess(slug, userId, true);
    if (!access.hasAccess || !access.canAdmin) {
      const isSuperAdmin = await checkIsSuperAdmin(userId);
      if (isSuperAdmin) {
        access = await validateWorkspaceAccess(slug, userId, true, { isSuperAdmin: true });
      }
    }

    if (!access.hasAccess || !access.canAdmin) {
      return NextResponse.json(
        { error: "Forbidden - admin access required" },
        { status: 403 }
      );
    }

    if (!access.workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const secrets = await db.workspaceSecret.findMany({
      where: { workspaceId: access.workspace.id },
      select: { id: true, name: true, description: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ secrets });
  } catch (error) {
    console.error("[SECRETS] Error listing secrets:", error);
    return NextResponse.json({ error: "Failed to list secrets" }, { status: 500 });
  }
}

/**
 * POST /api/workspaces/[slug]/secrets
 * Create a customer-scoped secret
 * Permissions: ADMIN+
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const userId = (session.user as { id: string }).id;

    // IDOR guard: resolve workspaceId from validated slug — never trust caller-supplied ID.
    // Deny-then-elevate: checkIsSuperAdmin only runs when normal membership check fails.
    let access = await validateWorkspaceAccess(slug, userId, true);
    let grantedViaSuperAdminBypass = false;
    if (!access.hasAccess || !access.canAdmin) {
      const isSuperAdmin = await checkIsSuperAdmin(userId);
      if (isSuperAdmin) {
        access = await validateWorkspaceAccess(slug, userId, true, { isSuperAdmin: true });
        grantedViaSuperAdminBypass = true;
      }
    }

    if (!access.hasAccess || !access.canAdmin) {
      return NextResponse.json(
        { error: "Forbidden - admin access required" },
        { status: 403 }
      );
    }

    if (!access.workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const workspaceId = access.workspace.id;

    // Validate body
    const body = await request.json();
    const { name, value, description } = body ?? {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!value || typeof value !== "string" || !value.trim()) {
      return NextResponse.json({ error: "value is required" }, { status: 400 });
    }

    // Fetch workspace with encrypted fields
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { stakworkApiKey: true, stakworkCustomerId: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    if (!workspace.stakworkCustomerId) {
      return NextResponse.json(
        { error: "Workspace is not yet provisioned with a Stakwork customer account" },
        { status: 422 }
      );
    }

    if (!workspace.stakworkApiKey) {
      return NextResponse.json(
        { error: "Workspace Stakwork API key is not configured" },
        { status: 422 }
      );
    }

    // Audit log for cross-tenant write via super-admin bypass — emitted
    // BEFORE any decrypt/external-call/DB-write so it is always traceable.
    if (grantedViaSuperAdminBypass) {
      logger.warn("[AUDIT] superAdminBypass", "SECRETS", {
        userId,
        workspaceId,
        slug,
        action: "secrets.create",
        superAdminBypass: true,
      });
    }

    // Decrypt the stakwork API key
    const decryptedToken = encryptionService.decryptField(
      "stakworkApiKey",
      workspace.stakworkApiKey
    );

    // Call Stakwork API — if this throws, we do NOT write to DB
    try {
      await stakworkService().createSecret(
        name.trim(),
        value.trim(),
        decryptedToken,
        workspace.stakworkCustomerId
      );
    } catch (err) {
      console.error("[SECRETS] Stakwork API call failed:", err);
      return NextResponse.json(
        { error: "Failed to create secret in Stakwork — no record saved" },
        { status: 502 }
      );
    }

    // Encrypt the value before storing
    const encryptedValue = encryptionService.encryptField("secretValue", value.trim());

    const secret = await db.workspaceSecret.create({
      data: {
        workspaceId,
        name: name.trim(),
        encryptedValue: JSON.stringify(encryptedValue),
        description: description?.trim() || null,
        createdById: userId,
      },
      select: { id: true, name: true, description: true, createdAt: true },
    });

    console.log("[SECRETS] Created:", secret.name, workspaceId);

    return NextResponse.json({ secret }, { status: 201 });
  } catch (error) {
    console.error("[SECRETS] Error creating secret:", error);
    return NextResponse.json({ error: "Failed to create secret" }, { status: 500 });
  }
}
