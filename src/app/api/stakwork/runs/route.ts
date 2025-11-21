import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { StakworkRunQuerySchema } from "@/types/stakwork";
import { getStakworkRuns } from "@/services/stakwork-run";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

/**
 * GET /api/stakwork/runs
 * Query Stakwork AI generation runs with filters
 * Query params: workspaceId (required), type, featureId, status, limit, offset
 */
export async function GET(request: NextRequest) {
  try {
    // Authenticate user
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const userId = userOrResponse.id;

    // Parse query parameters
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    const type = url.searchParams.get("type");
    const featureId = url.searchParams.get("featureId");
    const status = url.searchParams.get("status");
    const limit = url.searchParams.get("limit");
    const offset = url.searchParams.get("offset");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    // Build query object
    const queryData: Record<string, unknown> = {
      workspaceId,
    };

    if (type) {
      if (!Object.values(StakworkRunType).includes(type as StakworkRunType)) {
        return NextResponse.json({ error: `Invalid type: ${type}` }, { status: 400 });
      }
      queryData.type = type;
    }

    if (featureId) {
      queryData.featureId = featureId;
    }

    if (status) {
      if (!Object.values(WorkflowStatus).includes(status as WorkflowStatus)) {
        return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
      }
      queryData.status = status;
    }

    if (limit) {
      const limitNum = parseInt(limit);
      if (isNaN(limitNum) || limitNum <= 0 || limitNum > 100) {
        return NextResponse.json({ error: "limit must be between 1 and 100" }, { status: 400 });
      }
      queryData.limit = limitNum;
    }

    if (offset) {
      const offsetNum = parseInt(offset);
      if (isNaN(offsetNum) || offsetNum < 0) {
        return NextResponse.json({ error: "offset must be >= 0" }, { status: 400 });
      }
      queryData.offset = offsetNum;
    }

    // Validate with Zod schema
    const validationResult = StakworkRunQuerySchema.safeParse(queryData);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Invalid query parameters",
          details: validationResult.error.format(),
        },
        { status: 400 },
      );
    }

    const query = validationResult.data;

    // Get runs
    const result = await getStakworkRuns(query, userId);

    return NextResponse.json(
      {
        success: true,
        runs: result.runs.map((run) => ({
          id: run.id,
          type: run.type,
          status: run.status,
          workspaceId: run.workspaceId,
          featureId: run.featureId,
          projectId: run.projectId,
          result: run.result,
          dataType: run.dataType,
          decision: run.decision,
          feedback: run.feedback,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
          feature: run.feature,
        })),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching AI generation runs:", error);

    const errorMessage = error instanceof Error ? error.message : "Failed to fetch AI generation runs";

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
