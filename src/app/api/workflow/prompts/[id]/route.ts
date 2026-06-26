import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import {
  writePromptThrough,
  PromptNameInvalidError,
} from "@/services/prompts/prompt-sync";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

// ─── IDOR helper ──────────────────────────────────────────────────────────────

async function getPromptForUser(promptId: string, userId: string) {
  const prompt = await db.prompt.findUnique({
    where: { id: promptId },
    include: {
      versions: { orderBy: { versionNumber: "asc" } },
      publishedVersion: true,
      workspace: { select: { ownerId: true } },
    },
  });
  if (!prompt) return null;

  // IDOR: must be member or owner
  const member = await db.workspaceMember.findFirst({
    where: { workspaceId: prompt.workspaceId, userId },
  });
  if (!member && prompt.workspace.ownerId !== userId) return null;

  return prompt;
}

function toResponseShape(prompt: {
  id: string;
  name: string;
  value: string;
  description: string | null;
  publishedVersionId: string | null;
  syncStatus: string;
  stakworkId: number | null;
  createdAt: Date;
  updatedAt: Date;
  versions?: Array<{ id: string; versionNumber: number; published: boolean; createdAt: Date; whodunnit: string | null }>;
}) {
  const versionCount = prompt.versions?.length ?? 0;
  return {
    id: prompt.id,
    name: prompt.name,
    value: prompt.value,
    description: prompt.description ?? "",
    current_version_id: prompt.publishedVersionId,
    published_version_id: prompt.publishedVersionId,
    version_count: versionCount,
    sync_status: prompt.syncStatus,
    created_at: prompt.createdAt.toISOString(),
    updated_at: prompt.updatedAt.toISOString(),
  };
}

// ─── GET /api/workflow/prompts/[id] ──────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as { id?: string })?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const prompt = await getPromptForUser(id, userId);
    if (!prompt) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ success: true, data: toResponseShape(prompt) });
  } catch (error) {
    console.error("Error fetching prompt:", error);
    return NextResponse.json({ error: "Failed to fetch prompt" }, { status: 500 });
  }
}

// ─── PUT /api/workflow/prompts/[id] ──────────────────────────────────────────

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as { id?: string })?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const prompt = await getPromptForUser(id, userId);
    if (!prompt) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await request.json();
    const { value, description } = body as { value?: string; description?: string };
    if (!value) return NextResponse.json({ error: "value is required" }, { status: 400 });

    const updated = await writePromptThrough({
      promptId: id,
      name: prompt.name,
      value,
      description,
      workspaceId: prompt.workspaceId,
      userId,
    });

    return NextResponse.json({ success: true, data: toResponseShape(updated) });
  } catch (error) {
    if (error instanceof PromptNameInvalidError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Error updating prompt:", error);
    return NextResponse.json({ error: "Failed to update prompt" }, { status: 500 });
  }
}

// ─── DELETE /api/workflow/prompts/[id] ───────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as { id?: string })?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const prompt = await getPromptForUser(id, userId);
    if (!prompt) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Delete locally (cascade removes versions)
    await db.prompt.delete({ where: { id } });

    // Best-effort Stakwork delete
    if (prompt.stakworkId) {
      try {
        const baseUrl = config.STAKWORK_BASE_URL ?? "https://api.stakwork.com/api/v1";
        const apiKey = config.STAKWORK_API_KEY ?? "";
        await fetch(`${baseUrl}/prompts/${prompt.stakworkId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Token token=${apiKey}`,
            "Content-Type": "application/json",
          },
        });
      } catch (err) {
        logger.error(`[prompt-sync] delete write-through failed: id=${id} stakworkId=${prompt.stakworkId}`, "prompt-sync", { error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting prompt:", error);
    return NextResponse.json({ error: "Failed to delete prompt" }, { status: 500 });
  }
}
