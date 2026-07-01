import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { isDevelopmentMode } from "@/lib/runtime";
import { writePromptThrough, deletePrompt } from "@/services/prompts/prompt-sync";

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

function shapePromptDetail(p: {
  id: string;
  name: string;
  value: string;
  description: string | null;
  publishedVersionId: string | null;
  stakworkId: number | null;
  syncStatus: string;
  createdAt: Date;
  updatedAt: Date;
  versions: { id: string }[];
}) {
  return {
    id: p.id,
    name: p.name,
    value: p.value,
    description: p.description ?? "",
    published_version_id: p.publishedVersionId,
    current_version_id: p.publishedVersionId,
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
      include: { versions: { select: { id: true } } },
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
    const { name, value, description } = body as {
      name?: string;
      value?: string;
      description?: string;
    };

    if (!value) {
      return NextResponse.json({ error: "Value is required" }, { status: 400 });
    }

    // Fetch existing to get name if not provided
    const existing = await db.prompt.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    const { prompt } = await writePromptThrough({
      promptId: id,
      name: name ?? existing.name,
      value,
      description,
      userId,
    });

    return NextResponse.json({ success: true, data: shapePromptDetail({ ...prompt, versions: [] }) });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    console.error("Error updating prompt:", err);
    return NextResponse.json({ error: "Failed to update prompt" }, { status: 500 });
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
