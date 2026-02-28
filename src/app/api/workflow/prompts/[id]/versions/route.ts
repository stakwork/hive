import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

interface PromptVersion {
  id: number;
  version_number: number;
  created_at: string;
  whodunnit: string | null;
}

interface StakworkPromptVersionsResponse {
  success: boolean;
  data: {
    prompt_id: number;
    prompt_name: string;
    versions: PromptVersion[];
    current_version_id: number | null;
    version_count: number;
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Prompt ID is required" }, { status: 400 });
    }

    // In dev mode, call mock handler directly to avoid SSL issues
    if (devMode) {
      const { GET: mockGET } = await import("@/app/api/mock/stakwork/prompts/[id]/versions/route");
      return mockGET(_request, { params: Promise.resolve({ id }) });
    }

    // Fetch prompt versions from Stakwork API
    const versionsUrl = `${config.STAKWORK_BASE_URL}/prompts/${id}/versions`;

    const response = await fetch(versionsUrl, {
      method: "GET",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to fetch prompt versions for ${id}:`, errorText);
      return NextResponse.json(
        { error: "Failed to fetch prompt versions", details: errorText },
        { status: response.status },
      );
    }

    const result: StakworkPromptVersionsResponse = await response.json();

    if (!result.success) {
      return NextResponse.json({ error: "Failed to fetch prompt versions from Stakwork" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("Error fetching prompt versions:", error);
    return NextResponse.json({ error: "Failed to fetch prompt versions" }, { status: 500 });
  }
}
