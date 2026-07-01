import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { isDevelopmentMode } from "@/lib/runtime";
import { writePromptThrough } from "@/services/prompts/prompt-sync";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getAuthenticatedUserId(
  devMode: boolean,
): Promise<{ userId: string } | NextResponse> {
  if (devMode) {
    // In dev mode allow any authenticated session; fall back to a dev user id
    const session = await getServerSession(authOptions);
    return { userId: (session?.user as { id?: string })?.id ?? "dev-user" };
  }

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

// ─── Shape helpers ────────────────────────────────────────────────────────────

function shapePrompt(p: {
  id: string;
  name: string;
  value: string;
  description: string | null;
  publishedVersionId: string | null;
  stakworkId: number | null;
  syncStatus: string;
  createdAt: Date;
  updatedAt: Date;
  versions?: { id: string }[];
}) {
  return {
    id: p.id,
    name: p.name,
    value: p.value,
    description: p.description ?? "",
    published_version_id: p.publishedVersionId,
    current_version_id: p.publishedVersionId, // mirrors published for UI compat
    stakwork_id: p.stakworkId,
    sync_status: p.syncStatus,
    version_count: p.versions?.length ?? undefined,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

// ─── GET /api/workflow/prompts ────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const devMode = isDevelopmentMode();
    const authResult = await getAuthenticatedUserId(devMode);
    if (authResult instanceof NextResponse) return authResult;

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = 20;
    const search = searchParams.get("search");

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { description: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [prompts, total] = await Promise.all([
      db.prompt.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { versions: { select: { id: true } } },
      }),
      db.prompt.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        prompts: prompts.map(shapePrompt),
        total,
        size: pageSize,
        page,
      },
    });
  } catch (error) {
    console.error("Error fetching prompts:", error);
    return NextResponse.json({ error: "Failed to fetch prompts" }, { status: 500 });
  }
}

// ─── POST /api/workflow/prompts ───────────────────────────────────────────────

const PROMPT_NAME_REGEX = /^[A-Z0-9_]+$/;

export async function POST(request: NextRequest) {
  try {
    const devMode = isDevelopmentMode();
    const authResult = await getAuthenticatedUserId(devMode);
    if (authResult instanceof NextResponse) return authResult;
    const { userId } = authResult;

    const denied = await requireWriteAccess(userId, devMode);
    if (denied) return denied;

    const body = await request.json();
    const { name, value, description } = body as {
      name?: string;
      value?: string;
      description?: string;
    };

    if (!name || !value) {
      return NextResponse.json({ error: "Name and value are required" }, { status: 400 });
    }

    if (!PROMPT_NAME_REGEX.test(name)) {
      return NextResponse.json(
        { error: "Prompt name must contain only uppercase letters and underscores" },
        { status: 400 },
      );
    }

    const { prompt } = await writePromptThrough({ name, value, description, userId });

    return NextResponse.json({
      success: true,
      data: shapePrompt(prompt),
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 409) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("Error creating prompt:", err);
    return NextResponse.json({ error: "Failed to create prompt" }, { status: 500 });
  }
}
