import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { JanitorType } from "@prisma/client";

const VALID_JANITOR_TYPES: JanitorType[] = ["UNIT_TESTS", "INTEGRATION_TESTS"];

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
    const janitorType = type.toUpperCase() as JanitorType;

    if (!VALID_JANITOR_TYPES.includes(janitorType)) {
      return NextResponse.json(
        { error: "Invalid janitor type" },
        { status: 400 }
      );
    }

    const workspace = await db.workspace.findFirst({
      where: { 
        slug,
        members: {
          some: { 
            userId,
            role: { in: ["OWNER", "ADMIN", "PM", "DEVELOPER"] }
          }
        }
      },
      include: {
        janitorConfig: true
      }
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found or insufficient permissions" },
        { status: 404 }
      );
    }

    let config = workspace.janitorConfig;
    
    if (!config) {
      config = await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
        }
      });
    }

    const enabledField = janitorType === "UNIT_TESTS" 
      ? "unitTestsEnabled" 
      : "integrationTestsEnabled";
    
    if (!config[enabledField]) {
      return NextResponse.json(
        { error: `${janitorType.toLowerCase().replace('_', ' ')} janitor is not enabled` },
        { status: 400 }
      );
    }

    const existingRun = await db.janitorRun.findFirst({
      where: {
        janitorConfigId: config.id,
        janitorType,
        status: { in: ["PENDING", "RUNNING"] }
      }
    });

    if (existingRun) {
      return NextResponse.json(
        { error: "A janitor run of this type is already in progress" },
        { status: 409 }
      );
    }

    const run = await db.janitorRun.create({
      data: {
        janitorConfigId: config.id,
        janitorType,
        triggeredBy: "MANUAL",
        status: "PENDING",
        metadata: {
          triggeredByUserId: userId,
          workspaceSlug: slug,
        }
      }
    });

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
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}