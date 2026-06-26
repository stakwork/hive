import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { searchLatestByTypes, addNodeBulk } from "@/services/swarm/api/nodes";
import { config as envConfig } from "@/config/env";
import type { LingoExtractionState } from "../collect/route";
import type { JarvisNodePayload } from "@/services/jarvis-mirror/mappers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BULK_CHUNK = 100;

interface ExtractedTerm {
  name: string;
  definition?: string;
  lingo_type?: string;
  confidence: "high" | "medium" | "low";
  evidence?: string;
}

export async function POST(request: NextRequest) {
  // Auth
  const secret = request.headers.get("x-webhook-secret");
  if (!secret || secret !== process.env.JANITOR_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { workspaceId: string; terms: ExtractedTerm[]; cursor_state: LingoExtractionState };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { workspaceId, terms, cursor_state } = body;
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const allTerms: ExtractedTerm[] = Array.isArray(terms) ? terms : [];

  // 1. Filter to high confidence only
  const highConfidence = allTerms.filter((t) => t.confidence === "high");
  const skipped_confidence = allTerms.length - highConfidence.length;

  // 2. Deduplication against existing Lingo nodes
  const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
  const errors: string[] = [];
  let skipped_dedup = 0;
  let upserted = 0;

  if (!jarvisConfig) {
    return NextResponse.json(
      { upserted: 0, skipped_dedup: 0, skipped_confidence, errors: ["No Jarvis config available"] },
      { status: 200 },
    );
  }

  // Fetch existing Lingo nodes for dedup
  const existingResult = await searchLatestByTypes(jarvisConfig, { Lingo: 500 });
  const existingNames = new Set<string>();
  if (existingResult.ok) {
    for (const node of existingResult.nodes) {
      const name =
        (node.properties?.name as string | undefined) ??
        (node.node_type === "Lingo" ? (node as any).node_data?.name : undefined);
      if (name && typeof name === "string") {
        existingNames.add(name.toLowerCase().trim());
      }
    }
  }

  // Filter out duplicates
  const toUpsert = highConfidence.filter((t) => {
    const normalized = t.name.toLowerCase().trim();
    if (existingNames.has(normalized)) {
      skipped_dedup++;
      return false;
    }
    return true;
  });

  if (toUpsert.length === 0) {
    // Advance cursor even when no new terms (dedup emptied the list)
    if (cursor_state) {
      await db.workspace.update({
        where: { id: workspaceId },
        data: {
          lingoExtractionState: {
            ...cursor_state,
            lastProcessedAt: new Date().toISOString(),
          },
        },
      });
    }

    console.log(
      `[LingoExtraction] upsert — upserted=0 skipped_dedup=${skipped_dedup} skipped_confidence=${skipped_confidence} cursor_advanced=true`,
    );

    return NextResponse.json({ upserted: 0, skipped_dedup, skipped_confidence, errors });
  }

  // Map to JarvisNodePayload
  const payloads: JarvisNodePayload[] = toUpsert.map((t) => ({
    node_type: "Lingo",
    node_data: {
      name: t.name,
      definition: t.definition ?? "",
      lingo_type: t.lingo_type ?? "general",
      source: "human_extraction",
      confidence: t.confidence,
      evidence: t.evidence ?? "",
    },
  }));

  // 3. Bulk upsert in chunks of 100
  let jarvisSuccess = true;
  for (let i = 0; i < payloads.length; i += BULK_CHUNK) {
    const chunk = payloads.slice(i, i + BULK_CHUNK);
    const result = await addNodeBulk(jarvisConfig, chunk, { reprocess: true });
    if (!result.success) {
      jarvisSuccess = false;
      errors.push(...result.errors);
      break;
    }
    upserted += chunk.length;
  }

  // 4. Advance cursor only on success
  if (jarvisSuccess && cursor_state) {
    await db.workspace.update({
      where: { id: workspaceId },
      data: {
        lingoExtractionState: {
          ...cursor_state,
          lastProcessedAt: new Date().toISOString(),
        },
      },
    });
  }

  console.log(
    `[LingoExtraction] upsert — upserted=${upserted} skipped_dedup=${skipped_dedup} skipped_confidence=${skipped_confidence} cursor_advanced=${jarvisSuccess}`,
  );

  // 5. Best-effort hub-mirror trigger
  if (jarvisSuccess) {
    const baseUrl = envConfig.STAKWORK_BASE_URL.replace("/api/v1", "");
    try {
      await fetch(`${baseUrl}/api/cron/lingo-hub-mirror`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
    } catch (err) {
      console.error("[LingoExtraction] hub-mirror trigger failed:", err);
    }
  }

  return NextResponse.json({ upserted, skipped_dedup, skipped_confidence, errors });
}
