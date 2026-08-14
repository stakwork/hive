/**
 * GET /api/workspaces/[slug]/graph/agent/runs — Graph Agent Chat history.
 *
 *   - `?sessionId=` → runs in that thread, oldest first:
 *     `{ runs: [{ id, prompt, result, status, error, proposalsEnabled, createdAt }] }`
 *   - no sessionId → thread list (latest run per session), newest first:
 *     `{ threads: [{ sessionId, title, proposalsEnabled, lastStatus, updatedAt }] }`
 *
 * Admin/owner only (same gate as the dispatch route and the page). Every
 * query is scoped by `workspaceId` AND `agentKind: "graph_chat"` — canvas
 * workflow-explorer rows are never visible here.
 *
 * NOTE: middleware marks GET /api/workspaces/* as public, so this handler
 * does its own session check (same as the other graph GET routes).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { groupRunsIntoThreads } from "@/lib/graph-chat/threads";
import type { GraphChatRunStatus } from "@/types/graph-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const { slug } = await params;

    if (!session?.user) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }
    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ success: false, message: "Invalid user session" }, { status: 401 });
    }

    const access = await validateWorkspaceAccess(slug, userId, true);
    if (!access.hasAccess || !access.workspace) {
      return NextResponse.json({ success: false, message: "Workspace not found or access denied" }, { status: 404 });
    }
    if (!access.canAdmin) {
      return NextResponse.json({ success: false, message: "Forbidden: admin access required" }, { status: 403 });
    }
    const workspaceId = access.workspace.id;

    const sessionId = request.nextUrl.searchParams.get("sessionId");

    if (sessionId) {
      const runs = await db.agentRun.findMany({
        where: { workspaceId, agentKind: "graph_chat", sessionId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          prompt: true,
          result: true,
          status: true,
          error: true,
          proposalsEnabled: true,
          reflection: true,
          createdAt: true,
        },
      });
      return NextResponse.json({
        runs: runs.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      });
    }

    const rows = await db.agentRun.findMany({
      where: { workspaceId, agentKind: "graph_chat" },
      orderBy: { createdAt: "asc" },
      select: {
        sessionId: true,
        title: true,
        proposalsEnabled: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return NextResponse.json({
      threads: groupRunsIntoThreads(rows.map((r) => ({ ...r, status: r.status as GraphChatRunStatus }))),
    });
  } catch (e) {
    console.error("[graph-agent-chat] runs GET error", {
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
  }
}
