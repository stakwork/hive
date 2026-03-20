import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    // Verify user has access to stakwork workspace
    const stakworkWorkspace = await db.workspaces.findFirst({
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

    const { id, versionId } = await params;

    if (!id) {
      return NextResponse.json({ error: "Prompt ID is required" }, { status: 400 });
    }

    if (!versionId) {
      return NextResponse.json({ error: "Version ID is required" }, { status: 400 });
    }

    // In dev mode, delegate to mock handler to avoid SSL issues
    if (devMode) {
      const { POST: mockPOST } = await import(
        "@/app/api/mock/stakwork/prompts/[id]/versions/[versionId]/publish/route"
      );
      return mockPOST(request, { params: Promise.resolve({ id, versionId }) });
    }

    // Publish the version via Stakwork API
    const publishUrl = `${config.STAKWORK_BASE_URL}/prompts/${id}/versions/${versionId}/publish`;

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
        `Failed to publish prompt version ${versionId} for prompt ${id}:`,
        errorText
      );
      return NextResponse.json(
        { error: "Failed to publish prompt version", details: errorText },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error publishing prompt version:", error);
    return NextResponse.json(
      { error: "Failed to publish prompt version" },
      { status: 500 }
    );
  }
}
