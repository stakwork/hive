import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { z } from "zod";

const dismissRecommendationSchema = z.object({
  reason: z.string().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const validatedData = dismissRecommendationSchema.parse(body);

    const recommendation = await db.janitorRecommendation.findUnique({
      where: { id },
      include: {
        janitorRun: {
          include: {
            janitorConfig: {
              include: {
                workspace: {
                  include: {
                    members: {
                      where: { userId },
                      select: { role: true }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!recommendation) {
      return NextResponse.json(
        { error: "Recommendation not found" },
        { status: 404 }
      );
    }

    const userMembership = recommendation.janitorRun.janitorConfig.workspace.members[0];
    if (!userMembership || !["OWNER", "ADMIN", "PM", "DEVELOPER"].includes(userMembership.role)) {
      return NextResponse.json(
        { error: "Insufficient permissions to dismiss recommendations" },
        { status: 403 }
      );
    }

    if (recommendation.status !== "PENDING") {
      return NextResponse.json(
        { error: "Recommendation has already been processed" },
        { status: 400 }
      );
    }

    const updatedRecommendation = await db.janitorRecommendation.update({
      where: { id },
      data: {
        status: "DISMISSED",
        dismissedAt: new Date(),
        dismissedById: userId,
        metadata: {
          ...recommendation.metadata as object,
          dismissalReason: validatedData.reason,
        }
      },
      include: {
        dismissedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        }
      }
    });

    return NextResponse.json({
      success: true,
      recommendation: {
        id: updatedRecommendation.id,
        status: updatedRecommendation.status,
        dismissedAt: updatedRecommendation.dismissedAt,
        dismissedBy: updatedRecommendation.dismissedBy,
        metadata: updatedRecommendation.metadata,
      }
    });
  } catch (error) {
    console.error("Error dismissing recommendation:", error);
    
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