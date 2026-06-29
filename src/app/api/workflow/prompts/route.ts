import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import {
  writePromptThrough,
  seedWorkspacePromptsFromStakwork,
  PromptNameInvalidError,
  PromptConflictError,
} from "@/services/prompts/prompt-sync";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

// ─── helpers ─────────────────────────────────────────────────────────────────

async function getAuthedUser(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  const userId = (session.user as { id?: string })?.id;
  return userId ?? null;
}

async function resolveWorkspace(request: NextRequest, userId: string) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("workspace_slug");
  if (!slug) return null;
  return db.workspace.findFirst({
    where: {
      slug,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    select: { id: true, slug: true },
  });
}

// Map Hive prompt row → response shape the UI already expects
function toResponseShape(prompt: {
  id: string;
  name: string;
  value: string;
  description: string | null;
  publishedVersionId: string | null;
  syncStatus: string;
  createdAt: Date;
  updatedAt: Date;
  versions?: Array<{ id: string; versionNumber: number; published: boolean; createdAt: Date; whodunnit: string | null }>;
  publishedVersion?: { id: string } | null;
}) {
  const versionCount = prompt.versions?.length ?? 0;
  const currentVersionId = prompt.publishedVersionId;
  return {
    id: prompt.id,
    name: prompt.name,
    value: prompt.value,
    description: prompt.description ?? "",
    current_version_id: currentVersionId,
    published_version_id: currentVersionId, // live = published invariant
    version_count: versionCount,
    sync_status: prompt.syncStatus,
    created_at: prompt.createdAt.toISOString(),
    updated_at: prompt.updatedAt.toISOString(),
  };
}

// ─── GET /api/workflow/prompts ────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthedUser(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const size = Math.min(100, Math.max(1, parseInt(searchParams.get("size") ?? "20", 10)));
    const search = searchParams.get("search") ?? undefined;
    const slug = searchParams.get("workspace_slug");

    if (!slug) {
      return NextResponse.json({ error: "workspace_slug query param is required" }, { status: 400 });
    }

    // IDOR: user must be a member
    const workspace = await db.workspace.findFirst({
      where: {
        slug,
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
      select: { id: true, promptsSyncedAt: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 403 });
    }

    // Bulk seed: runs once per workspace when the local prompt set is empty and
    // we haven't seeded before. Uses promptsSyncedAt as a one-time marker so a
    // workspace that genuinely has zero Stakwork prompts doesn't re-hit the API
    // on every list call.
    if (!workspace.promptsSyncedAt && !search) {
      const localCount = await db.prompt.count({ where: { workspaceId: workspace.id } });
      if (localCount === 0) {
        await seedWorkspacePromptsFromStakwork(workspace.id);
      }
    }

    const where = {
      workspaceId: workspace.id,
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
    };

    const [prompts, total] = await Promise.all([
      db.prompt.findMany({
        where,
        include: {
          versions: { select: { id: true, versionNumber: true, published: true, createdAt: true, whodunnit: true } },
          publishedVersion: { select: { id: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * size,
        take: size,
      }),
      db.prompt.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        prompts: prompts.map(toResponseShape),
        total,
        size,
        page,
      },
    });
  } catch (error) {
    console.error("Error fetching prompts:", error);
    return NextResponse.json({ error: "Failed to fetch prompts" }, { status: 500 });
  }
}

// ─── POST /api/workflow/prompts ───────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthedUser(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, value, description, workspace_slug } = body as {
      name?: string;
      value?: string;
      description?: string;
      workspace_slug?: string;
    };

    if (!name || !value) {
      return NextResponse.json({ error: "name and value are required" }, { status: 400 });
    }
    if (!workspace_slug) {
      return NextResponse.json({ error: "workspace_slug is required" }, { status: 400 });
    }

    // IDOR
    const workspace = await db.workspace.findFirst({
      where: {
        slug: workspace_slug,
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
      select: { id: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 403 });
    }

    const prompt = await writePromptThrough({
      name,
      value,
      description,
      workspaceId: workspace.id,
      userId,
    });

    return NextResponse.json({ success: true, data: toResponseShape(prompt) }, { status: 201 });
  } catch (error) {
    if (error instanceof PromptNameInvalidError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof PromptConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Error creating prompt:", error);
    return NextResponse.json({ error: "Failed to create prompt" }, { status: 500 });
  }
}
