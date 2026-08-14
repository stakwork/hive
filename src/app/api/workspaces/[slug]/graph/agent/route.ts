/**
 * POST /api/workspaces/[slug]/graph/agent — Graph Agent Chat dispatch.
 *
 * One user message = one one-shot `repo/agent` dispatch (mode: "graph")
 * against the workspace's own swarm, with a webhook fan-back URL. The
 * terminal result lands on the `AgentRun` row via /api/agent-runs/webhook
 * and a Pusher nudge refreshes the sidebar. Session continuity is
 * server-side on the swarm (history keyed by `sessionId`) — Hive stores
 * only prompt/result pairs for display.
 *
 * Body: `{ prompt, sessionId?, proposalsEnabled? }`.
 *   - No sessionId → new thread: mint a UUID; `proposalsEnabled` comes from
 *     the modal checkbox and is snapshotted onto the run.
 *   - sessionId → follow-up: the per-thread proposals setting is IMMUTABLE —
 *     the server re-snapshots it from the latest run in the session and
 *     rejects a client attempt to flip it mid-thread (409).
 *
 * Auth: admin/owner only — same gate as the graph query route and the page.
 *
 * NEVER log the raw token or the full webhookUrl.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import crypto from "crypto";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getSwarmConfig } from "@/app/api/learnings/utils";
import { dispatchRepoAgent } from "@/lib/ai/askTools";
import { getPublicBaseUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROMPT_LENGTH = 20_000;
const TITLE_MAX = 120;

/** Thread title from the opening prompt: first line, length-capped. */
function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split("\n", 1)[0].trim() || "Graph chat";
  return firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX)}…` : firstLine;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
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

    let body: {
      prompt?: unknown;
      sessionId?: unknown;
      proposalsEnabled?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 });
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      return NextResponse.json({ success: false, message: "prompt is required" }, { status: 400 });
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json({ success: false, message: "prompt is too long" }, { status: 400 });
    }
    if (body.sessionId !== undefined && typeof body.sessionId !== "string") {
      return NextResponse.json({ success: false, message: "sessionId must be a string" }, { status: 400 });
    }
    if (body.proposalsEnabled !== undefined && typeof body.proposalsEnabled !== "boolean") {
      return NextResponse.json({ success: false, message: "proposalsEnabled must be a boolean" }, { status: 400 });
    }

    // ── Thread resolution ───────────────────────────────────────────────────
    // The per-thread proposals setting is decided at creation and snapshotted
    // onto every run. On follow-ups the server derives it from the latest run
    // — the client-sent flag is only cross-checked, never trusted.
    let sessionId: string;
    let proposalsEnabled: boolean;
    if (body.sessionId) {
      const latest = await db.agentRun.findFirst({
        where: { workspaceId, agentKind: "graph_chat", sessionId: body.sessionId },
        orderBy: { createdAt: "desc" },
        select: { proposalsEnabled: true },
      });
      if (!latest) {
        return NextResponse.json({ success: false, message: "Unknown chat thread" }, { status: 404 });
      }
      if (body.proposalsEnabled !== undefined && body.proposalsEnabled !== latest.proposalsEnabled) {
        return NextResponse.json(
          {
            success: false,
            message: "proposalsEnabled cannot change after thread creation",
          },
          { status: 409 },
        );
      }
      sessionId = body.sessionId;
      proposalsEnabled = latest.proposalsEnabled;
    } else {
      sessionId = crypto.randomUUID();
      proposalsEnabled = body.proposalsEnabled === true;
    }

    // ── Swarm resolution (before creating any row — no orphans on config
    //    errors). Mocks short-circuit to the mock stakgraph repo/agent. ─────
    let swarmUrl: string;
    let swarmApiKey: string;
    if (config.USE_MOCKS) {
      swarmUrl = `${config.MOCK_BASE}/api/mock/stakgraph`;
      swarmApiKey = "mock";
    } else {
      const swarmConfig = await getSwarmConfig(workspaceId);
      if ("error" in swarmConfig) {
        return NextResponse.json({ success: false, message: swarmConfig.error }, { status: swarmConfig.status });
      }
      swarmUrl = swarmConfig.baseSwarmUrl;
      swarmApiKey = swarmConfig.decryptedSwarmApiKey;
    }

    const workspace = await db.workspace.findFirst({
      where: { id: workspaceId },
      select: { slug: true, sourceControlOrgId: true },
    });

    // ── Fan-back arbitration row (mirrors setupFanBack) ────────────────────
    // High-entropy token — stored hashed, carried raw in the webhookUrl the
    // swarm POSTs back to. NEVER log rawToken or the full webhookUrl.
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    const run = await db.agentRun.create({
      data: {
        tokenHash,
        agentKind: "graph_chat",
        workspaceId,
        workspaceSlug: workspace?.slug ?? slug,
        orgId: workspace?.sourceControlOrgId ?? null,
        userId,
        sessionId,
        prompt,
        proposalsEnabled,
        title: titleFromPrompt(prompt),
      },
      select: { id: true },
    });

    const webhookUrl = `${getPublicBaseUrl(request)}/api/agent-runs/webhook?id=${run.id}&token=${rawToken}`;

    try {
      // `proposalsEnabled` is enforced server-side per dispatch: toolsConfig
      // is omitted entirely unless the thread was created with it on.
      // `reflect` is deliberately NOT sent: Concept READS are recorded to the
      // session sidecar (and delivered on the terminal webhook) regardless;
      // the opt-in only adds a post-run ranking pass that would hold the run
      // open for an extra agent call on every message.
      const requestId = await dispatchRepoAgent(swarmUrl, swarmApiKey, {
        prompt,
        mode: "graph",
        sessionId,
        ...(proposalsEnabled
          ? {
              toolsConfig: {
                propose_concept_change: true,
                list_concept_proposals: true,
              },
            }
          : {}),
        webhookUrl,
      });
      console.log("[graph-agent-chat] dispatched", { runId: run.id, requestId });

      // Save requestId for observability — best-effort, NOT part of the
      // arbitration key.
      await db.agentRun.update({ where: { id: run.id }, data: { requestId } }).catch((e) =>
        console.warn("[graph-agent-chat] requestId save failed (non-fatal)", {
          runId: run.id,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } catch (e) {
      // Initiation failure: the swarm never accepted the run, so no callback
      // can ever arrive. Claim PENDING → FAILED (guarded, as the webhook may
      // never race us but a cancel could).
      await db.agentRun.updateMany({
        where: { id: run.id, status: "PENDING" },
        data: {
          status: "FAILED",
          error: e instanceof Error ? e.message : "initiation_failed",
        },
      });
      console.error("[graph-agent-chat] dispatch failed — run FAILED", {
        runId: run.id,
      });
      return NextResponse.json(
        {
          success: false,
          message: "Failed to dispatch graph agent",
          runId: run.id,
          sessionId,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ runId: run.id, sessionId });
  } catch (e) {
    console.error("[graph-agent-chat] unexpected error", {
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
  }
}
