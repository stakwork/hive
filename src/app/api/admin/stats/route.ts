import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const { searchParams } = new URL(request.url);
    const window = searchParams.get("window") || "all";

    // Compute since date based on window parameter
    let since: Date | null = null;
    if (window === "24h") {
      since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    } else if (window === "7d") {
      since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    } else if (window === "30d") {
      since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }
    // If window is "all" or any invalid value, since remains null

    // Build date filter
    const dateFilter = since ? { createdAt: { gte: since } } : {};

    // Run all queries in parallel
    const [
      tasksCompleted,
      tasksInProgress,
      tasksCreated,
      prsMerged,
      activePods,
      totalUsers,
    ] = await Promise.all([
      db.task.count({
        where: {
          status: "DONE",
          ...dateFilter,
        },
      }),
      db.task.count({
        where: {
          status: "IN_PROGRESS",
          ...dateFilter,
        },
      }),
      db.task.count({
        where: {
          ...dateFilter,
        },
      }),
      db.artifact.count({
        where: {
          type: "PULL_REQUEST",
          content: {
            path: ["status"],
            equals: "DONE",
          },
          ...dateFilter,
        },
      }),
      db.pod.count({
        where: {
          status: "RUNNING",
          deletedAt: null,
        },
      }),
      db.user.count({
        where: {
          deleted: false,
        },
      }),
    ]);

    return NextResponse.json({
      tasksCompleted,
      tasksInProgress,
      tasksCreated,
      prsMerged,
      activePods,
      totalUsers,
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
