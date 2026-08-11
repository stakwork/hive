import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrApiToken } from "@/lib/auth/api-token";
import { StakworkRunQuerySchema } from "@/types/stakwork";
import { getStakworkRuns } from "@/services/stakwork-run";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";
import { checkRateLimit } from "@/lib/rate-limit";
import { canReadRunReport } from "@/lib/run-report/types";
import { redactSensitiveKeys } from "@/lib/run-report/redact";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

/**
 * The exact set of fields returned per-run. Declared as a required type so a
 * future omission of `hasReport` becomes a compile error rather than a silent
 * optional fallthrough.
 *
 * `reportUrl`, `webhookUrl`, `userId`, `taskId`, `autoAccept`, `promptVersionId`,
 * and `evalSetId` are deliberately absent — this is a de-facto response allowlist.
 * Do NOT replace the mapper literal with a spread.
 */
interface RunResponseRow {
  id: string;
  type: string;
  status: string;
  workspaceId: string;
  featureId: string | null;
  projectId: number | null;
  result?: string | null;
  dataType: string;
  decision: string | null;
  feedback: string | null;
  createdAt: Date;
  updatedAt: Date;
  feature: { id: string; title: string } | null;
  /** Required — never optional. Omitting it is a compile error. */
  hasReport: boolean;
}

const LOG_SERVICE = "stakwork-runs/route";

/**
 * GET /api/stakwork/runs
 * Query Stakwork AI generation runs with filters
 * Query params: workspaceId (required), type, featureId, status, limit, offset
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    const userOrResponse = await requireAuthOrApiToken(request, workspaceId);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const userId = userOrResponse.id;

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 }
      );
    }

    // Rate limit keyed on the AUTHENTICATED SESSION USER, not the client IP.
    // getClientIp derives identity from the client-controlled x-forwarded-for
    // header, so an IP-keyed limit is trivially spoofed.
    try {
      const limit = await checkRateLimit(`stakwork-runs:${userId}`, 120, 60);
      if (!limit.allowed) {
        return NextResponse.json(
          { error: "Too many requests", retryAfter: limit.retryAfter },
          { status: 429 }
        );
      }
    } catch (rateLimitError) {
      logger.warn("[stakwork-runs] Rate limit unavailable — failing open", LOG_SERVICE, {
        error: String(rateLimitError),
      });
    }

    const type = url.searchParams.get("type");
    const featureId = url.searchParams.get("featureId");
    const status = url.searchParams.get("status");
    const limit = url.searchParams.get("limit");
    const offset = url.searchParams.get("offset");

    // Build query object
    const queryData: Record<string, unknown> = {
      workspaceId,
    };

    if (type) {
      if (!Object.values(StakworkRunType).includes(type as StakworkRunType)) {
        return NextResponse.json(
          { error: `Invalid type: ${type}` },
          { status: 400 }
        );
      }
      queryData.type = type;
    }

    if (featureId) {
      queryData.featureId = featureId;
    }

    if (status) {
      if (!Object.values(WorkflowStatus).includes(status as WorkflowStatus)) {
        return NextResponse.json(
          { error: `Invalid status: ${status}` },
          { status: 400 }
        );
      }
      queryData.status = status;
    }

    if (limit) {
      const limitNum = parseInt(limit);
      if (isNaN(limitNum) || limitNum <= 0 || limitNum > 100) {
        return NextResponse.json(
          { error: "limit must be between 1 and 100" },
          { status: 400 }
        );
      }
      queryData.limit = limitNum;
    }

    if (offset) {
      const offsetNum = parseInt(offset);
      if (isNaN(offsetNum) || offsetNum < 0) {
        return NextResponse.json(
          { error: "offset must be >= 0" },
          { status: 400 }
        );
      }
      queryData.offset = offsetNum;
    }

    // Parse includeResult param (must be after other params, before Zod validation)
    queryData.includeResult = url.searchParams.get("includeResult") === "true";

    // Validate with Zod schema
    const validationResult = StakworkRunQuerySchema.safeParse(queryData);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Invalid query parameters",
          details: validationResult.error.format(),
        },
        { status: 400 }
      );
    }

    const query = validationResult.data;

    // Get runs — callerRole is derived from the verified workspace membership,
    // never from a client-supplied value.
    const result = await getStakworkRuns(query, userId);
    const { callerRole } = result;

    return NextResponse.json(
      {
        success: true,
        runs: result.runs.map((run): RunResponseRow => {
          // Redact nested bundle pointers from the result JSON. The ingest strip
          // removes only the top-level report_url; normalizeLegalBenchmarkPayload
          // may nest it under result.result.report_url or alongside scores_s3_url.
          // Re-serialize to string so the field type is stable (the DB stores it
          // as a JSON string; callers expect a JSON string back).
          let safeResult: string | null | undefined = (run as { result?: string | null }).result;
          if (query.includeResult && run.result != null) {
            try {
              const parsed = typeof run.result === "string"
                ? JSON.parse(run.result as string)
                : run.result;
              const redacted = redactSensitiveKeys(parsed);
              safeResult = JSON.stringify(redacted);
            } catch {
              // If the result isn't valid JSON, redact keys from the raw string
              // is not possible — emit as-is. The result field is best-effort.
              safeResult = run.result as string;
            }
          }

          return {
            id: run.id,
            type: run.type,
            status: run.status,
            workspaceId: run.workspaceId,
            featureId: run.featureId,
            projectId: run.projectId,
            ...(query.includeResult ? { result: safeResult } : {}),
            dataType: run.dataType,
            decision: run.decision,
            feedback: run.feedback,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
            feature: run.feature,
            // Gate on the caller's verified role so VIEWER/STAKEHOLDER never
            // get a link the report route will 403. Computed from the same
            // membership the query authorized — no client-supplied value.
            hasReport: run.hasReport === true && canReadRunReport(callerRole),
          } satisfies RunResponseRow;
        }),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching AI generation runs:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Failed to fetch AI generation runs";

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
