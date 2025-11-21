import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { dismissJanitorRecommendation } from "@/services/janitor";
import { JANITOR_ERRORS } from "@/lib/constants/janitor";
import { z } from "zod";

const dismissRecommendationSchema = z.object({
  reason: z.string().optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const validatedData = dismissRecommendationSchema.parse(body);

    const updatedRecommendation = await dismissJanitorRecommendation(id, userId, validatedData);

    return NextResponse.json({
      success: true,
      recommendation: {
        id: updatedRecommendation.id,
        status: updatedRecommendation.status,
        dismissedAt: updatedRecommendation.dismissedAt,
        dismissedBy: updatedRecommendation.dismissedBy,
        metadata: updatedRecommendation.metadata,
      },
    });
  } catch (error) {
    console.error("Error dismissing recommendation:", error);

    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json({ error: "Validation failed", details: error.issues }, { status: 400 });
    }

    if (error instanceof Error) {
      if (error.message === JANITOR_ERRORS.RECOMMENDATION_NOT_FOUND) {
        return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
      }
      if (error.message === JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS) {
        return NextResponse.json({ error: "Insufficient permissions to dismiss recommendations" }, { status: 403 });
      }
      if (error.message === JANITOR_ERRORS.RECOMMENDATION_ALREADY_PROCESSED) {
        return NextResponse.json({ error: "Recommendation has already been processed" }, { status: 400 });
      }
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
