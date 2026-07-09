import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { kgGetNodesByType } from "@/lib/ai/kg-adapter";
import { jargonScore } from "@/lib/utils/lingo-extraction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type LingoExtractionState = {
  backwardsCursor?: string; // ISO — oldest createdAt seen so far
  reachedFloor?: boolean; // true once backfill complete
  lastProcessedAt?: string; // ISO — forward cursor after floor reached
  hasMore?: boolean; // true when batch hit the limit (more pages available)
};

type SourceEntry = {
  text_index: number;
  source_type: string;
  source_id: string;
  score: number;
};

export async function POST(request: NextRequest) {
  // Auth — matches the standard Stakwork callback convention (x-api-token / API_TOKEN)
  const apiToken = request.headers.get("x-api-token");
  if (!apiToken || apiToken !== process.env.API_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { workspaceId: string; limit?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { workspaceId, limit: rawLimit } = body;
  const limit = typeof rawLimit === "number" && rawLimit > 0 ? rawLimit : 200;
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
      take: limit,
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
      reachedFloor: batch.length < limit,
      hasMore: batch.length >= limit,
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
      take: limit,
      select: { id: true, message: true, createdAt: true },
    });

    for (const msg of batch) {
      if (typeof msg.message === "string" && msg.message.trim()) {
        allTexts.push(msg.message);
        allSourceIds.push(msg.id);
        allSourceTypes.push("HiveChatMessage");
      }
    }

    cursorState = { ...state, hasMore: batch.length >= limit };
  }

  // --- Jarvis sources (Episodes/Calls + HiveChatMessage + Sphinx Message) ---
  const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
  if (jarvisConfig) {
    const { jarvisUrl, apiKey } = jarvisConfig;

    // Source 2: Episodes and Calls — parallel fetch, 50 each
    const [episodeNodes, callNodes] = await Promise.all([
      kgGetNodesByType(jarvisUrl, apiKey, "Episode", 50),
      kgGetNodesByType(jarvisUrl, apiKey, "Call", 50),
    ]);
    for (const node of [...episodeNodes, ...callNodes]) {
      const props = node.properties as Record<string, unknown> | undefined;
      const text =
        (props?.description as string | undefined) ??
        (props?.transcript as string | undefined);
      if (!text) continue;
      allTexts.push(text);
      allSourceIds.push(node.ref_id);
      allSourceTypes.push(node.node_type ?? "Episode");
    }

    // Source 3: HiveChatMessage nodes
    const hiveChatNodes = await kgGetNodesByType(jarvisUrl, apiKey, "HiveChatMessage", 200);
    for (const node of hiveChatNodes) {
      const props = node.properties as Record<string, unknown> | undefined;
      if (props?.role === "assistant") continue;
      const text = props?.content as string | undefined;
      if (!text || !text.trim()) continue;
      allTexts.push(text);
      allSourceIds.push(node.ref_id);
      allSourceTypes.push("HiveChatMessage");
    }

    // Source 4: Sphinx tribe Message nodes
    // node_key: message-uuid | text field: content | skip empty content
    const messageNodes = await kgGetNodesByType(jarvisUrl, apiKey, "Message", 200);
    for (const node of messageNodes) {
      const props = node.properties as Record<string, unknown> | undefined;
      const text = props?.content as string | undefined;
      if (!text || !text.trim()) continue;
      allTexts.push(text);
      allSourceIds.push(node.ref_id);
      allSourceTypes.push("Message");
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
