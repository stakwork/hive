import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

// Accepts numeric IDs or UUIDs (v4-style)
const SAFE_ID_RE = /^[0-9a-f-]+$/i;

function isSafeId(value: string): boolean {
  return SAFE_ID_RE.test(value) && !value.includes("..");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ scriptId: string; versionId: string }> }
) {
  try {
    const userOrResponse = requireAuth(getMiddlewareContext(request));
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    // Verify user has access to stakwork workspace
    const stakworkWorkspace = await db.workspace.findFirst({
      where: {
        slug: "stakwork",
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
    });

    const devMode = isDevelopmentMode();

    if (!stakworkWorkspace && !devMode) {
      return NextResponse.json(
        { error: "Access denied - not a member of stakwork workspace" },
        { status: 403 }
      );
    }

    const { scriptId, versionId } = await params;

    if (!scriptId) {
      return NextResponse.json({ error: "Script ID is required" }, { status: 400 });
    }

    if (!versionId) {
      return NextResponse.json({ error: "Version ID is required" }, { status: 400 });
    }

    if (!isSafeId(scriptId)) {
      return NextResponse.json({ error: "Invalid script ID format" }, { status: 400 });
    }

    if (!isSafeId(versionId)) {
      return NextResponse.json({ error: "Invalid version ID format" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({})) as { artifactId?: string };
    const { artifactId } = body;

    // In dev mode, delegate to mock handler to avoid SSL issues
    if (devMode) {
      const { POST: mockPOST } = await import(
        "@/app/api/mock/stakwork/scripts/[scriptId]/versions/[versionId]/publish/route"
      );
      const mockResult = await mockPOST(request, { params: Promise.resolve({ scriptId, versionId }) });

      if (artifactId) {
        await updateArtifactPublished(artifactId, stakworkWorkspace?.id ?? null, devMode);
      }

      return mockResult;
    }

    // Publish the script version via Stakwork API
    const publishUrl = `${config.STAKWORK_BASE_URL}/scripts/${encodeURIComponent(scriptId)}/versions/${encodeURIComponent(versionId)}/publish`;

    const response = await fetch(publishUrl, {
      method: "POST",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Failed to publish script ${scriptId} version ${versionId}:`,
        errorText
      );
      return NextResponse.json(
        { error: "Failed to publish script version" },
        { status: response.status }
      );
    }

    if (artifactId) {
      await updateArtifactPublished(artifactId, stakworkWorkspace?.id ?? null, devMode);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error publishing script version:", error);
    return NextResponse.json(
      { error: "Failed to publish script version" },
      { status: 500 }
    );
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
