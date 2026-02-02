import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { validateWorkspaceAccess } from "@/services/workspace";
import { createApiKey, listApiKeys } from "@/lib/api-keys";
import { createApiKeySchema } from "@/lib/schemas/api-keys";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/workspaces/[slug]/api-keys
 * List all API keys for a workspace
 * Permissions: OWNER, ADMIN, PM, DEVELOPER (canWrite)
 */
export async function GET(
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

    // Check workspace access - need write permission
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

    const keys = await listApiKeys(access.workspace.id);
    return NextResponse.json({ keys });
  } catch (error) {
    logger.error("Error listing API keys", "API_KEYS", { error });
    return NextResponse.json(
      { error: "Failed to list API keys" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/workspaces/[slug]/api-keys
 * Create a new API key for a workspace
 * Permissions: OWNER, ADMIN, PM, DEVELOPER (canWrite)
 *
 * Note: The raw key is only returned once in this response!
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

    // Check workspace access - need write permission
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

    // Parse and validate request body
    const body = await request.json();
    const parseResult = createApiKeySchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid request body",
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { name, expiresAt } = parseResult.data;

    // Create the API key
    const apiKey = await createApiKey({
      workspaceId: access.workspace.id,
      name,
      createdById: userId,
      expiresAt,
    });

    logger.info("API key created", "API_KEYS", {
      workspaceId: access.workspace.id,
      keyId: apiKey.id,
      createdById: userId,
    });

    // Return the key - this is the only time the raw key is returned!
    return NextResponse.json(apiKey, { status: 201 });
  } catch (error) {
    logger.error("Error creating API key", "API_KEYS", { error });
    return NextResponse.json(
      { error: "Failed to create API key" },
      { status: 500 }
    );
  }
}
