import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { z } from "zod";

const updateJanitorConfigSchema = z.object({
  unitTestsEnabled: z.boolean().optional(),
  integrationTestsEnabled: z.boolean().optional(),
  e2eTestsEnabled: z.boolean().optional(),
  securityReviewEnabled: z.boolean().optional(),
  mockGenerationEnabled: z.boolean().optional(),
  generalRefactoringEnabled: z.boolean().optional(),
  taskCoordinatorEnabled: z.boolean().optional(),
  recommendationSweepEnabled: z.boolean().optional(),
  ticketSweepEnabled: z.boolean().optional(),
  prMonitorEnabled: z.boolean().optional(),
  prConflictFixEnabled: z.boolean().optional(),
  prCiFailureFixEnabled: z.boolean().optional(),
  prOutOfDateFixEnabled: z.boolean().optional(),
  prUseMergeForUpdates: z.boolean().optional(),
  prUseRebaseForUpdates: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { id: workspaceId } = await params;

  // First verify workspace exists
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });

  if (!workspace) {
    return NextResponse.json(
      { error: "Workspace not found" },
      { status: 404 }
    );
  }

  // Get or create janitor config
  const config = await db.janitorConfig.upsert({
    where: { workspaceId },
    create: { workspaceId },
    update: {},
  });

  return NextResponse.json({ config });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { id: workspaceId } = await params;

  try {
    const body = await request.json();
    const validatedData = updateJanitorConfigSchema.parse(body);

    const config = await db.janitorConfig.update({
      where: { workspaceId },
      data: validatedData,
    });

    return NextResponse.json({ config });
  } catch (error) {
    console.error("Error updating janitor config:", error);

    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json(
        { error: "Validation failed", details: error },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
