import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ scriptId: string; versionId: string }> }
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

    if (devMode) {
      const { GET: mockGET } = await import(
        "@/app/api/mock/stakwork/scripts/[scriptId]/versions/[versionId]/route"
      );
      return mockGET(_request, { params: Promise.resolve({ scriptId, versionId }) });
    }

    const versionUrl = `${config.STAKWORK_BASE_URL}/scripts/${scriptId}/versions/${versionId}`;

    const response = await fetch(versionUrl, {
      method: "GET",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to fetch script version ${versionId} for script ${scriptId}:`, errorText);
      return NextResponse.json(
        { error: "Failed to fetch script version", details: errorText },
        { status: response.status }
      );
    }

    const result = await response.json();

    if (!result.success) {
      return NextResponse.json(
        { error: "Failed to fetch script version from Stakwork" },
        { status: 400 }
      );
    }

    const raw = result.data;
    return NextResponse.json({ success: true, data: { ...raw, value: raw.source_code ?? raw.value } });
  } catch (error) {
    console.error("Error fetching script version:", error);
    return NextResponse.json({ error: "Failed to fetch script version" }, { status: 500 });
  }
}
