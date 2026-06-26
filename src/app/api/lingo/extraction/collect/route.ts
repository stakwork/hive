import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { searchLatestByTypes } from "@/services/swarm/api/nodes";
import { jargonScore } from "@/lib/utils/lingo-extraction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type LingoExtractionState = {
  backwardsCursor?: string; // ISO — oldest createdAt seen so far
  reachedFloor?: boolean; // true once backfill complete
  lastProcessedAt?: string; // ISO — forward cursor after floor reached
};

type SourceEntry = {
  text_index: number;
  source_type: string;
  source_id: string;
  score: number;
};

export async function POST(request: NextRequest) {
  // Auth
  const secret = request.headers.get("x-webhook-secret");
  if (!secret || secret !== process.env.JANITOR_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { workspaceId: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { workspaceId } = body;
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { lingoExtractionState: true },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const state = (workspace.lingoExtractionState as LingoExtractionState) ?? {};

  const allTexts: string[] = [];
  const allSourceIds: string[] = [];
  const allSourceTypes: string[] = [];

  const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  let cursorState: LingoExtractionState;

  if (!state.reachedFloor) {
    // Backwards mode — backfill newest-first going back
    const backwardsCursor = state.backwardsCursor ?? new Date().toISOString();

    const batch = await db.chatMessage.findMany({
      where: {
        role: "USER",
        userId: { not: null },
        createdAt: { lt: new Date(backwardsCursor), gt: THIRTY_DAYS_AGO },
        task: { workspaceId },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true, message: true, createdAt: true },
    });

    for (const msg of batch) {
      if (typeof msg.message === "string" && msg.message.trim()) {
        allTexts.push(msg.message);
        allSourceIds.push(msg.id);
        allSourceTypes.push("HiveChatMessage");
      }
    }

    const newBackwardsCursor =
      batch.length > 0
        ? batch[batch.length - 1].createdAt.toISOString()
        : backwardsCursor;

    cursorState = {
      ...state,
      backwardsCursor: newBackwardsCursor,
      reachedFloor: batch.length < 500,
    };
  } else {
    // Forward mode — pick up new messages since last run
    const lastProcessedAt = state.lastProcessedAt;

    const batch = await db.chatMessage.findMany({
      where: {
        role: "USER",
        userId: { not: null },
        ...(lastProcessedAt ? { createdAt: { gt: new Date(lastProcessedAt) } } : {}),
        task: { workspaceId },
      },
      orderBy: { createdAt: "asc" },
      take: 500,
      select: { id: true, message: true, createdAt: true },
    });

    for (const msg of batch) {
      if (typeof msg.message === "string" && msg.message.trim()) {
        allTexts.push(msg.message);
        allSourceIds.push(msg.id);
        allSourceTypes.push("HiveChatMessage");
      }
    }

    cursorState = { ...state };
  }

  // --- Jarvis sources (Episodes/Calls + HiveChatMessage/Sphinx) ---
  const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
  if (jarvisConfig) {
    // Source 2: Episodes and Calls
    const episodeCallResult = await searchLatestByTypes(jarvisConfig, { Episode: 50, Call: 50 });
    if (episodeCallResult.ok) {
      for (const node of episodeCallResult.nodes) {
        const text =
          (node.properties?.description as string | undefined) ??
          (node.properties?.transcript as string | undefined);
        if (!text) continue; // silently skip
        allTexts.push(text);
        allSourceIds.push(node.ref_id);
        allSourceTypes.push(node.node_type ?? "Episode");
      }
    }

    // Source 3: Sphinx HiveChatMessage nodes
    const sphinxResult = await searchLatestByTypes(jarvisConfig, { HiveChatMessage: 200 });
    if (sphinxResult.ok) {
      for (const node of sphinxResult.nodes) {
        // Skip assistant messages
        const nodeData = node.properties as Record<string, unknown> | undefined;
        if (nodeData?.role === "assistant") continue;
        const text = nodeData?.content as string | undefined;
        if (!text || !text.trim()) continue;
        allTexts.push(text);
        allSourceIds.push(node.ref_id);
        allSourceTypes.push("HiveChatMessage");
      }
    }
  }

  // --- Jargon score filter ---
  const total_before_filter = allTexts.length;
  const filteredTexts: string[] = [];
  const source_map: SourceEntry[] = [];

  for (let i = 0; i < allTexts.length; i++) {
    const score = jargonScore(allTexts[i]);
    if (score >= 4) {
      const text_index = filteredTexts.length;
      filteredTexts.push(allTexts[i]);
      source_map.push({
        text_index,
        source_type: allSourceTypes[i],
        source_id: allSourceIds[i],
        score,
      });
    }
  }

  const total_after_filter = filteredTexts.length;

  const mode = !state.reachedFloor ? "backwards" : "forward";
  console.log(
    `[LingoExtraction] collect — workspaceId=${workspaceId} mode=${mode} total_before_filter=${total_before_filter} total_after_filter=${total_after_filter}`,
  );

  return NextResponse.json({
    texts: filteredTexts,
    source_map,
    total_before_filter,
    total_after_filter,
    cursor_state: cursorState,
  });
}
