import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { optionalEnvVars } from "@/config/env";
import { getBaseUrl } from "@/lib/utils";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ slug: string; workflowId: string }>;
};

function computeCacheKey(versionIds: string[]): string {
  return crypto
    .createHash("sha256")
    .update([...versionIds].sort().join(","))
    .digest("hex")
    .slice(0, 16);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug, workflowId } = await params;

    // Auth — session or Bearer token
    const session = await getServerSession(authOptions);
    let userId = (session?.user as { id?: string })?.id ?? null;

    if (!userId) {
      const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET! });
      if (token?.id && typeof token.id === "string") {
        userId = token.id;
      }
    }

    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // Validate workflowId
    const workflowIdNum = parseInt(workflowId, 10);
    if (isNaN(workflowIdNum)) {
      return NextResponse.json({ success: false, error: "Invalid workflowId" }, { status: 400 });
    }

    // Parse body
    let body: { versionIds?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const { versionIds } = body;
    if (!Array.isArray(versionIds) || versionIds.length < 2 || versionIds.length > 5) {
      return NextResponse.json(
        { success: false, error: "versionIds must be an array of 2–5 items" },
        { status: 400 },
      );
    }
    const versionIdsStr: string[] = versionIds.map(String);

    // IDOR guard — fetch workspace and verify membership
    const workspace = await db.workspace.findFirst({
      where: { slug, deleted: false },
      include: {
        members: {
          where: { userId, leftAt: null },
          select: { role: true },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { success: false, error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.length > 0;
    if (!isOwner && !isMember) {
      return NextResponse.json(
        { success: false, error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    // Compute cache key
    const cacheKey = computeCacheKey(versionIdsStr);

    // Check for existing completed summary — scoped to this workspace to prevent
    // cross-workspace cache leakage (different workspaces may share a workflowId).
    const existing = await db.workflowSummary.findFirst({
      where: { workflowId: workflowIdNum, workspaceId: workspace.id, cacheKey, status: "COMPLETE" },
    });

    if (existing) {
      return NextResponse.json(
        { cached: true, content: existing.content, summaryId: existing.id },
        { status: 200 },
      );
    }

    // Upsert WorkflowSummary (PENDING)
    const record = await db.workflowSummary.upsert({
      where: { workflowId_cacheKey: { workflowId: workflowIdNum, cacheKey } },
      update: { status: "PENDING", versionIds: versionIdsStr },
      create: {
        workflowId: workflowIdNum,
        workspaceId: workspace.id,
        cacheKey,
        versionIds: versionIdsStr,
        status: "PENDING",
      },
    });

    const baseUrl = getBaseUrl(request.headers.get("host"));
    const callbackUrl = `${baseUrl}/api/workspaces/${slug}/workflows/${workflowId}/summarise/callback?summary_id=${record.id}`;

    // Determine target URL
    const useMocks = process.env.USE_MOCKS === "true";
    const stakworkURL = useMocks
      ? `${baseUrl}/api/mock/workspaces/${slug}/workflows/${workflowId}/summarise`
      : `${optionalEnvVars.STAKWORK_BASE_URL}/projects`;

    const stakworkPayload = {
      name: `workflow-summary-${workflowIdNum}-${record.id}`,
      workflow_id: parseInt(optionalEnvVars.STAKWORK_WORKFLOW_SUMMARY_WORKFLOW_ID ?? "0", 10),
      webhook_url: `${baseUrl}/api/stakwork/webhook`,
      workflow_params: {
        set_var: {
          attributes: {
            vars: {
              workflow_id: workflowIdNum,
              version_ids: versionIdsStr,
              callback_url: callbackUrl,
              tokenReference: getStakworkTokenReference(),
            },
          },
        },
      },
    };

    const response = await fetch(stakworkURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token=${optionalEnvVars.STAKWORK_API_KEY}`,
      },
      body: JSON.stringify(stakworkPayload),
    });

    if (!response.ok) {
      await db.workflowSummary.update({
        where: { id: record.id },
        data: { status: "FAILED" },
      });
      return NextResponse.json(
        { success: false, error: "Failed to trigger summary workflow" },
        { status: 500 },
      );
    }

    return NextResponse.json({ summaryId: record.id, cached: false }, { status: 201 });
  } catch (error) {
    console.error("[Workflow Summarise] POST error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
