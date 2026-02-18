import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { fetchBlobContent } from "@/lib/utils/blob-fetch";

/**
 * GET /api/agent-logs
 *
 * Fetch agent log records for a workspace with optional filtering, pagination,
 * time range, and keyword search.
 *
 * Query params:
 *   workspace_id:     string  — required, for access control
 *   stakwork_run_id?: string  — optional filter by StakworkRun
 *   task_id?:         string  — optional filter by Task
 *   limit?:           number  — pagination limit (default: 20, max: 100)
 *   skip?:            number  — pagination offset (default: 0)
 *   start_date?:      string  — ISO date string, filter logs after this date
 *   end_date?:        string  — ISO date string, filter logs before this date
 *   search?:          string  — keyword search within blob content (case-insensitive)
 */
export async function GET(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspace_id");
    const stakworkRunId = searchParams.get("stakwork_run_id");
    const taskId = searchParams.get("task_id");
    const search = searchParams.get("search");
    const startDateParam = searchParams.get("start_date");
    const endDateParam = searchParams.get("end_date");

    // Parse pagination parameters
    const limitParam = searchParams.get("limit");
    const skipParam = searchParams.get("skip");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 20;
    const skip = skipParam ? parseInt(skipParam, 10) : 0;

    // Validate required parameters
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspace_id is required" },
        { status: 400 }
      );
    }

    // Validate pagination parameters
    if (isNaN(limit) || limit < 1) {
      return NextResponse.json(
        { error: "limit must be a positive number" },
        { status: 400 }
      );
    }

    if (isNaN(skip) || skip < 0) {
      return NextResponse.json(
        { error: "skip must be a non-negative number" },
        { status: 400 }
      );
    }

    // Build filter
    const where: {
      workspaceId: string;
      stakworkRunId?: string;
      taskId?: string;
      createdAt?: {
        gte?: Date;
        lte?: Date;
      };
    } = { workspaceId };

    if (stakworkRunId) where.stakworkRunId = stakworkRunId;
    if (taskId) where.taskId = taskId;

    // Add date range filtering
    if (startDateParam || endDateParam) {
      where.createdAt = {};
      if (startDateParam) {
        const startDate = new Date(startDateParam);
        if (isNaN(startDate.getTime())) {
          return NextResponse.json(
            { error: "start_date must be a valid ISO date string" },
            { status: 400 }
          );
        }
        where.createdAt.gte = startDate;
      }
      if (endDateParam) {
        const endDate = new Date(endDateParam);
        if (isNaN(endDate.getTime())) {
          return NextResponse.json(
            { error: "end_date must be a valid ISO date string" },
            { status: 400 }
          );
        }
        where.createdAt.lte = endDate;
      }
    }

    // Fetch logs and total count in parallel
    const [logs, total] = await Promise.all([
      db.agentLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
        select: {
          id: true,
          blobUrl: true,
          agent: true,
          stakworkRunId: true,
          taskId: true,
          createdAt: true,
        },
      }),
      db.agentLog.count({ where }),
    ]);

    // ⚠️ PERFORMANCE WARNING:
    // Keyword search fetches blob content for each log, which can be slow
    // for workspaces with many logs. Consider:
    // - Adding caching layer for blob content
    // - Limiting max results when search is used
    // - Implementing server-side indexing for log content
    let filteredLogs = logs;
    if (search) {
      const logsWithContent = await Promise.all(
        logs.map(async (log) => {
          try {
            const content = await fetchBlobContent(log.blobUrl);
            return {
              log,
              matches: content.toLowerCase().includes(search.toLowerCase()),
            };
          } catch (error) {
            console.error(`Failed to fetch blob content for log ${log.id}:`, error);
            // If blob fetch fails, exclude from search results
            return { log, matches: false };
          }
        })
      );
      filteredLogs = logsWithContent.filter((l) => l.matches).map((l) => l.log);
    }

    // Calculate hasMore
    const hasMore = skip + limit < total;

    return NextResponse.json(
      {
        data: filteredLogs,
        total,
        hasMore,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching agent logs:", error);
    return NextResponse.json(
      { error: "Failed to fetch agent logs" },
      { status: 500 }
    );
  }
}
