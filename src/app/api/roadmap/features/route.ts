import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { FeaturePriority } from "@prisma/client";
import { z } from "zod";

const createFeatureSchema = z.object({
  workspaceId: z.string().cuid(),
  title: z.string().min(1, "Title is required"),
  brief: z.string().optional(),
  priority: z.nativeEnum(FeaturePriority).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validation = createFeatureSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request data", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const { workspaceId, title, brief, priority } = validation.data;

    // Verify workspace access
    const workspace = await db.workspace.findFirst({
      where: {
        id: workspaceId,
        members: {
          some: {
            userId: session.user.id,
          },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 }
      );
    }

    // Set default priority if not provided
    const featurePriority = priority || FeaturePriority.MEDIUM;

    // Create feature
    const feature = await db.feature.create({
      data: {
        workspaceId,
        title,
        brief: brief || "",
        priority: featurePriority,
        createdById: session.user.id,
        updatedById: session.user.id,
      },
    });

    return NextResponse.json(feature, { status: 201 });
  } catch (error) {
    console.error("Error creating feature:", error);
    return NextResponse.json(
      { error: "Failed to create feature" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 }
      );
    }

    // Verify workspace access
    const workspace = await db.workspace.findFirst({
      where: {
        id: workspaceId,
        members: {
          some: {
            userId: session.user.id,
          },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 }
      );
    }

    const features = await db.feature.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });

    return NextResponse.json(features);
  } catch (error) {
    console.error("Error fetching features:", error);
    return NextResponse.json(
      { error: "Failed to fetch features" },
      { status: 500 }
    );
  }
}
