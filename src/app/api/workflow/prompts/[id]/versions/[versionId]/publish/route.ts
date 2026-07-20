import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { isDevelopmentMode } from "@/lib/runtime";
import { publishVersion } from "@/services/prompts/prompt-sync";
import { validateApiToken, API_TOKEN_ACTOR } from "@/lib/auth/api-token";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    let actor: string;
    let workspaceId: string | undefined;

    if (validateApiToken(request)) {
      // ── Token branch ──────────────────────────────────────────────────────
      const ip = getClientIp(request);
      const rl = await checkRateLimit(`prompts:publish:api-token:${ip}`, 30, 60);
      if (!rl.allowed) {
        return new NextResponse(JSON.stringify({ error: "Too many requests" }), {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfter ?? 60), "Content-Type": "application/json" },
        });
      }
      const workspace = await db.workspace.findFirst({ where: { slug: "stakwork" } });
      workspaceId = workspace?.id;
      actor = API_TOKEN_ACTOR;
    } else {
      // ── Session branch (verbatim existing behavior) ───────────────────────
      const userOrResponse = requireAuth(getMiddlewareContext(request));
      if (userOrResponse instanceof NextResponse) return userOrResponse;
      const userId = userOrResponse.id;

      const devMode = isDevelopmentMode();

      if (!devMode) {
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
        workspaceId = workspace.id;
      }

      actor = userId;
    }

    const { id, versionId } = await params;
    if (!id) {
      return NextResponse.json({ error: "Prompt ID is required" }, { status: 400 });
    }
    if (!versionId) {
      return NextResponse.json({ error: "Version ID is required" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({})) as { artifactId?: string };
    const { artifactId } = body;

    // Publish the version in Hive (+ best-effort Stakwork push inside service)
    await publishVersion(id, versionId, workspaceId ?? undefined, actor);

    // Optionally update artifact published state
    const devMode = isDevelopmentMode();
    if (artifactId) {
      await updateArtifactPublished(artifactId, workspaceId ?? null, devMode);
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    console.error("Error publishing prompt version:", err);
    return NextResponse.json({ error: "Failed to publish prompt version" }, { status: 500 });
  }
}

async function updateArtifactPublished(
  artifactId: string,
  workspaceId: string | null,
  devMode: boolean,
): Promise<void> {
  try {
    const artifact = await db.artifact.findUnique({
      where: { id: artifactId },
      include: {
        message: {
          include: {
            task: { select: { workspaceId: true } },
          },
        },
      },
    });
    if (!artifact) return;

    const artifactWorkspaceId = artifact.message?.task?.workspaceId;
    const callerHasAccess = devMode || (workspaceId && artifactWorkspaceId === workspaceId);
    if (!callerHasAccess) return;

    const current = (artifact.content as Record<string, unknown>) ?? {};
    await db.artifact.update({
      where: { id: artifactId },
      data: { content: { ...current, published: true } },
    });
  } catch (err) {
    console.error("Error updating artifact published state:", err);
  }
}
