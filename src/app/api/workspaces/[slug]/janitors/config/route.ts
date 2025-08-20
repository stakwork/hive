import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { z } from "zod";
import { getOrCreateJanitorConfig, updateJanitorConfig } from "@/services/janitor";
import { validateWorkspaceAccess } from "@/lib/helpers/janitor-permissions";
import { JANITOR_ERRORS } from "@/lib/constants/janitor";

const updateJanitorConfigSchema = z.object({
  unitTestsEnabled: z.boolean().optional(),
  integrationTestsEnabled: z.boolean().optional(),
});

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

    const { workspace } = await validateWorkspaceAccess(slug, userId, "VIEW");
    const config = await getOrCreateJanitorConfig(workspace.id);

    return NextResponse.json({ config });
  } catch (error) {
    console.error("Error fetching janitor config:", error);
    
    if (error instanceof Error && error.message === JANITOR_ERRORS.WORKSPACE_NOT_FOUND) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

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
    const body = await request.json();
    const validatedData = updateJanitorConfigSchema.parse(body);

    const { workspace } = await validateWorkspaceAccess(slug, userId, "CONFIGURE");
    const config = await updateJanitorConfig(workspace.id, userId, validatedData);

    return NextResponse.json({ 
      success: true,
      config 
    });
  } catch (error) {
    console.error("Error updating janitor config:", error);
    
    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    if (error instanceof Error) {
      if (error.message === JANITOR_ERRORS.WORKSPACE_NOT_FOUND) {
        return NextResponse.json(
          { error: "Workspace not found or access denied" },
          { status: 404 }
        );
      }
      if (error.message === JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS) {
        return NextResponse.json(
          { error: "Insufficient permissions" },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}