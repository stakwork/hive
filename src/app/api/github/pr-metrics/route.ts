import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { PullRequestContent } from "@/lib/chat";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface PRMetricsResponse {
  successRate: number | null;
  avgTimeToMerge: number | null;
  prCount: number;
  mergedCount: number;
}

/**
 * Calculates PR metrics for a workspace over the last 72 hours.
 * Tracks success rate (merged PRs / total PRs) and average time to merge.
 */
export async function GET(request: Request) {
  try {
    // 1️⃣ Auth check
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2️⃣ Validate input
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json(
        { error: "Missing required parameter: workspaceId" },
        { status: 400 }
      );
    }

    // 3️⃣ Query PR artifacts from last 72 hours
    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);

    const artifacts = await db.artifact.findMany({
      where: {
        type: "PULL_REQUEST",
        createdAt: {
          gte: seventyTwoHoursAgo,
        },
        message: {
          task: {
            workspaceId,
          },
        },
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // 4️⃣ Calculate metrics
    const prCount = artifacts.length;
    let mergedCount = 0;
    let totalMergeTimeHours = 0;

    for (const artifact of artifacts) {
      // Type-safe content parsing
      const content = artifact.content as unknown as PullRequestContent;
      
      if (content?.status === "DONE") {
        mergedCount++;
        // Calculate time to merge in hours
        const timeToMergeMs = artifact.updatedAt.getTime() - artifact.createdAt.getTime();
        const timeToMergeHours = timeToMergeMs / (1000 * 60 * 60);
        totalMergeTimeHours += timeToMergeHours;
      }
    }

    // 5️⃣ Calculate success rate (null if < 3 PRs)
    const successRate = prCount >= 3 
      ? Math.round((mergedCount / prCount) * 100 * 100) / 100 // Round to 2 decimals
      : null;

    // 6️⃣ Calculate average time to merge (null if no merged PRs)
    const avgTimeToMerge = mergedCount > 0
      ? Math.round((totalMergeTimeHours / mergedCount) * 100) / 100 // Round to 2 decimals
      : null;

    // 7️⃣ Return metrics
    const response: PRMetricsResponse = {
      successRate,
      avgTimeToMerge,
      prCount,
      mergedCount,
    };

    return NextResponse.json(response, { status: 200 });

  } catch (error) {
    console.error("[PR METRICS] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
