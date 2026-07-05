import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { isDevelopmentMode } from "@/lib/runtime";
import { writePromptThrough, deletePrompt } from "@/services/prompts/prompt-sync";
import { BIFROST_AGENT_NAMES } from "@/services/bifrost/agent-names";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

// ─── Auth helpers ──────────────────────────────────────────────────────────────

async function getAuthenticatedUserId(
  devMode: boolean,
): Promise<{ userId: string } | NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id?: string })?.id;
  if (!userId) {
    return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
  }
  return { userId };
}

async function requireWriteAccess(
  userId: string,
  devMode: boolean,
): Promise<NextResponse | null> {
  if (devMode) return null;
  const workspace = await db.workspace.findFirst({
    where: {
      slug: "stakwork",
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
  });
  if (!workspace) {
    return NextResponse.json(
      { error: "Access denied - not a member of stakwork workspace" },
      { status: 403 },
    );
  }
  return null;
}

// ─── Shape helper ─────────────────────────────────────────────────────────────

const VALID_AGENT_NAMES = new Set<string>(BIFROST_AGENT_NAMES);

function normalizeAgentNames(names: unknown): string[] | { error: string } {
  if (!Array.isArray(names)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const n of names) {
    if (typeof n !== "string") continue;
    const trimmed = n.trim();
    if (!trimmed) continue;
    if (!VALID_AGENT_NAMES.has(trimmed)) {
      return { error: `Invalid agent name: "${trimmed}"` };
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function shapePromptDetail(p: {
  id: string;
  name: string;
  value: string;
  description: string | null;
  agentNames: string[];
  publishedVersionId: string | null;
  stakworkId: number | null;
  syncStatus: string;
  createdAt: Date;
  updatedAt: Date;
  versions: { id: string; versionNumber: number; value: string }[];
}) {
  // current_version_id = latest (highest versionNumber) version id.
  // This differs from published_version_id when an unpublished draft exists.
  const latestVersion = p.versions[0]; // already ordered versionNumber desc
  const currentVersionId = latestVersion?.id ?? p.publishedVersionId;
  const currentValue = latestVersion?.value ?? p.value;

  return {
    id: p.id,
    name: p.name,
    value: currentValue,
    description: p.description ?? "",
    agent_names: p.agentNames,
    published_version_id: p.publishedVersionId,
    current_version_id: currentVersionId,
    stakwork_id: p.stakworkId,
    sync_status: p.syncStatus,
    version_count: p.versions.length,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

// ─── GET /api/workflow/prompts/[id] ──────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const devMode = isDevelopmentMode();
    const authResult = await getAuthenticatedUserId(devMode);
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Prompt ID is required" }, { status: 400 });
    }

    const prompt = await db.prompt.findUnique({
      where: { id },
      include: {
        versions: {
          select: { id: true, versionNumber: true, value: true },
          orderBy: { versionNumber: "desc" },
        },
      },
    });
    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: shapePromptDetail(prompt) });
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
    const devMode = isDevelopmentMode();
    const authResult = await getAuthenticatedUserId(devMode);
    if (authResult instanceof NextResponse) return authResult;
    const { userId } = authResult;

    const denied = await requireWriteAccess(userId, devMode);
    if (denied) return denied;

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Prompt ID is required" }, { status: 400 });
    }

    const body = await request.json();
    const { name, value, description, agentNames } = body as {
      name?: string;
      value?: string;
      description?: string;
      agentNames?: unknown;
    };

    if (!value) {
      return NextResponse.json({ error: "Value is required" }, { status: 400 });
    }

    // Fetch existing to get name if not provided
    const existing = await db.prompt.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    const normalizedAgentNames = agentNames !== undefined ? normalizeAgentNames(agentNames) : undefined;
    if (normalizedAgentNames !== undefined && !Array.isArray(normalizedAgentNames)) {
      return NextResponse.json({ error: normalizedAgentNames.error }, { status: 400 });
    }

    await writePromptThrough({
      promptId: id,
      name: name ?? existing.name,
      value,
      description,
      agentNames: normalizedAgentNames,
      userId,
    });

    // Refetch with versions (ordered desc) so shapePromptDetail can expose current_version_id = latest draft.
    const updated = await db.prompt.findUnique({
      where: { id },
      include: {
        versions: {
          select: { id: true, versionNumber: true, value: true },
          orderBy: { versionNumber: "desc" },
        },
      },
    });
    if (!updated) {
      return NextResponse.json({ error: "Prompt not found after update" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: shapePromptDetail(updated) });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    if (e.status === 409) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("Error updating prompt:", err);
    return NextResponse.json({ error: "Failed to update prompt" }, { status: 500 });
  }
}

// ─── PATCH /api/workflow/prompts/[id] ────────────────────────────────────────
// Lightweight update for Prompt-level metadata that is NOT versioned (agent
// names). Unlike PUT, this never creates a new draft version and never touches
// the publish lifecycle — it writes directly to the Prompt row.

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const devMode = isDevelopmentMode();
    const authResult = await getAuthenticatedUserId(devMode);
    if (authResult instanceof NextResponse) return authResult;
    const { userId } = authResult;

    const denied = await requireWriteAccess(userId, devMode);
    if (denied) return denied;

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Prompt ID is required" }, { status: 400 });
    }

    const body = await request.json();
    const { agentNames } = body as { agentNames?: unknown };

    if (agentNames === undefined) {
      return NextResponse.json({ error: "agentNames is required" }, { status: 400 });
    }

    const normalizedAgentNames = normalizeAgentNames(agentNames);
    if (!Array.isArray(normalizedAgentNames)) {
      return NextResponse.json({ error: normalizedAgentNames.error }, { status: 400 });
    }

    const existing = await db.prompt.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    await db.prompt.update({
      where: { id },
      data: { agentNames: normalizedAgentNames },
    });

    // Refetch with versions (ordered desc) so the response shape matches GET/PUT.
    const updated = await db.prompt.findUnique({
      where: { id },
      include: {
        versions: {
          select: { id: true, versionNumber: true, value: true },
          orderBy: { versionNumber: "desc" },
        },
      },
    });
    if (!updated) {
      return NextResponse.json({ error: "Prompt not found after update" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: shapePromptDetail(updated) });
  } catch (err: unknown) {
    console.error("Error updating prompt agent names:", err);
    return NextResponse.json({ error: "Failed to update agent names" }, { status: 500 });
  }
}

// ─── DELETE /api/workflow/prompts/[id] ───────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const devMode = isDevelopmentMode();
    const authResult = await getAuthenticatedUserId(devMode);
    if (authResult instanceof NextResponse) return authResult;
    const { userId } = authResult;

    const denied = await requireWriteAccess(userId, devMode);
    if (denied) return denied;

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Prompt ID is required" }, { status: 400 });
    }

    await deletePrompt(id);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    console.error("Error deleting prompt:", err);
    return NextResponse.json({ error: "Failed to delete prompt" }, { status: 500 });
  }
}
