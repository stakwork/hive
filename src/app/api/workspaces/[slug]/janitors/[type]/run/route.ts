import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { createJanitorRun } from "@/services/janitor";
import { validateWorkspaceAccess } from "@/lib/helpers/janitor-permissions";
import { parseJanitorType } from "@/lib/helpers/janitor-validation";
import { JANITOR_ERRORS } from "@/lib/constants/janitor";


export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; type: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug, type } = await params;
    
    const janitorType = parseJanitorType(type);
    const { workspace } = await validateWorkspaceAccess(slug, userId, "EXECUTE");
    
    const run = await createJanitorRun(
      workspace.id,
      userId,
      janitorType,
      "MANUAL"
    );

    return NextResponse.json({
      success: true,
      run: {
        id: run.id,
        janitorType: run.janitorType,
        status: run.status,
        triggeredBy: run.triggeredBy,
        createdAt: run.createdAt,
      }
    });
  } catch (error) {
    console.error("Error triggering janitor run:", error);
    
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
      if (error.message === JANITOR_ERRORS.JANITOR_DISABLED) {
        return NextResponse.json(
          { error: "This janitor type is not enabled" },
          { status: 400 }
        );
      }
      if (error.message === JANITOR_ERRORS.RUN_IN_PROGRESS) {
        return NextResponse.json(
          { error: "A janitor run of this type is already in progress" },
          { status: 409 }
        );
      }
      if (error.message.includes("Invalid janitor type")) {
        return NextResponse.json(
          { error: "Invalid janitor type" },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}