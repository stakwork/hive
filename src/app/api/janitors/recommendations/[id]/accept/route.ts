import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { acceptJanitorRecommendation } from "@/services/janitor";
import { JANITOR_ERRORS } from "@/lib/constants/janitor";
import { z } from "zod";

const acceptRecommendationSchema = z.object({
  assigneeId: z.string().optional(),
  repositoryId: z.string().optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    console.log("Accept route called");
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;
    console.log("Session user ID:", userId);

    if (!userId) {
      console.log("No user ID found, returning unauthorized");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const validatedData = acceptRecommendationSchema.parse(body);

    const { recommendation, task } = await acceptJanitorRecommendation(id, userId, validatedData);

    return NextResponse.json({
      success: true,
      task,
      recommendation: {
        id: recommendation.id,
        status: recommendation.status,
        acceptedAt: recommendation.acceptedAt,
      },
    });
  } catch (error) {
    console.error("Error accepting recommendation:", error);

    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json({ error: "Validation failed", details: error.issues }, { status: 400 });
    }

    if (error instanceof Error) {
      if (error.message === JANITOR_ERRORS.RECOMMENDATION_NOT_FOUND) {
        return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
      }
      if (error.message === JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS) {
        return NextResponse.json({ error: "Insufficient permissions to accept recommendations" }, { status: 403 });
      }
      if (error.message === JANITOR_ERRORS.RECOMMENDATION_ALREADY_PROCESSED) {
        return NextResponse.json({ error: "Recommendation has already been processed" }, { status: 400 });
      }
      if (error.message === JANITOR_ERRORS.ASSIGNEE_NOT_MEMBER) {
        return NextResponse.json({ error: "Assignee is not a member of this workspace" }, { status: 400 });
      }
      if (error.message === JANITOR_ERRORS.REPOSITORY_NOT_FOUND) {
        return NextResponse.json({ error: "Repository not found in this workspace" }, { status: 400 });
      }
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
