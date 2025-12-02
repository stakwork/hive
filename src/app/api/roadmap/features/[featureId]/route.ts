import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { FeaturePriority } from "@prisma/client";
import { z } from "zod";

const updateFeatureSchema = z.object({
  title: z.string().min(1).optional(),
  brief: z.string().optional(),
  priority: z.nativeEnum(FeaturePriority).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { featureId } = await params;
    const body = await request.json();
    const validation = updateFeatureSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request data", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    // Verify feature exists and user has access
    const existingFeature = await db.feature.findFirst({
      where: {
        id: featureId,
        workspace: {
          members: {
            some: {
              userId: session.user.id,
            },
          },
        },
      },
    });

    if (!existingFeature) {
      return NextResponse.json(
        { error: "Feature not found or access denied" },
        { status: 404 }
      );
    }

    const updateData: any = { updatedById: session.user.id };
    if (validation.data.title !== undefined) {
      updateData.title = validation.data.title;
    }
    if (validation.data.brief !== undefined) {
      updateData.brief = validation.data.brief;
    }
    if (validation.data.priority !== undefined) {
      updateData.priority = validation.data.priority;
    }

    const updatedFeature = await db.feature.update({
      where: { id: featureId },
      data: updateData,
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

    return NextResponse.json(updatedFeature);
  } catch (error) {
    console.error("Error updating feature:", error);
    return NextResponse.json(
      { error: "Failed to update feature" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { featureId } = await params;

    // Verify feature exists and user has access
    const existingFeature = await db.feature.findFirst({
      where: {
        id: featureId,
        workspace: {
          members: {
            some: {
              userId: session.user.id,
            },
          },
        },
      },
    });

    if (!existingFeature) {
      return NextResponse.json(
        { error: "Feature not found or access denied" },
        { status: 404 }
      );
    }

    await db.feature.delete({
      where: { id: featureId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting feature:", error);
    return NextResponse.json(
      { error: "Failed to delete feature" },
      { status: 500 }
    );
  }
}
