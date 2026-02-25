import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

interface PromptVersionDetail {
  id: number;
  version_id: number;
  version_number: number;
  name: string;
  value: string;
  description: string;
  usage_notation: string;
  created_at: string;
}

interface StakworkPromptVersionDetailResponse {
  success: boolean;
  data: PromptVersionDetail;
}

export async function GET(
  _request: NextRequest,
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
    const stakworkWorkspace = await db.workspace.findFirst({
      where: {
        slug: "stakwork",
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
    });

    const devMode = isDevelopmentMode();

    if (!stakworkWorkspace && !devMode) {
      return NextResponse.json({ error: "Access denied - not a member of stakwork workspace" }, { status: 403 });
    }

    const { id, versionId } = await params;

    if (!id) {
      return NextResponse.json({ error: "Prompt ID is required" }, { status: 400 });
    }

    if (!versionId) {
      return NextResponse.json({ error: "Version ID is required" }, { status: 400 });
    }

    // Fetch specific version detail from Stakwork API
    const versionUrl = `${config.STAKWORK_BASE_URL}/prompts/${id}/versions/${versionId}`;

    const response = await fetch(versionUrl, {
      method: "GET",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to fetch prompt version ${versionId} for prompt ${id}:`, errorText);
      return NextResponse.json(
        { error: "Failed to fetch prompt version", details: errorText },
        { status: response.status },
      );
    }

    const result: StakworkPromptVersionDetailResponse = await response.json();

    if (!result.success) {
      return NextResponse.json({ error: "Failed to fetch prompt version from Stakwork" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("Error fetching prompt version:", error);
    return NextResponse.json({ error: "Failed to fetch prompt version" }, { status: 500 });
  }
}
