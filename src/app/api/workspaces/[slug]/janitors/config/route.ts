import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { z } from "zod";

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

    const workspace = await db.workspace.findFirst({
      where: { 
        slug,
        members: {
          some: { userId }
        }
      },
      include: {
        janitorConfig: true
      }
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
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

    return NextResponse.json({ config });
  } catch (error) {
    console.error("Error fetching janitor config:", error);
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

    const workspace = await db.workspace.findFirst({
      where: { 
        slug,
        members: {
          some: { 
            userId,
            role: { in: ["OWNER", "ADMIN", "PM"] }
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
          ...validatedData,
        }
      });
    } else {
      config = await db.janitorConfig.update({
        where: { id: config.id },
        data: validatedData,
      });
    }

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

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}