import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

interface StakworkPromptDetail {
  id: number;
  name: string;
  value: string;
  description: string;
  usage_notation: string;
  current_version_id: number | null;
  version_count: number;
}

interface StakworkPromptDetailResponse {
  success: boolean;
  data: StakworkPromptDetail;
}

interface UpdatePromptRequest {
  value: string;
  description?: string;
}

interface UpdatePromptResponse {
  success: boolean;
  data: string;
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

    // Fetch prompt detail from Stakwork API
    const promptUrl = `${config.STAKWORK_BASE_URL}/prompts/${id}`;

    const response = await fetch(promptUrl, {
      method: "GET",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to fetch prompt ${id} from Stakwork:`, errorText);
      return NextResponse.json(
        { error: "Failed to fetch prompt", details: errorText },
        { status: response.status },
      );
    }

    const result: StakworkPromptDetailResponse = await response.json();

    if (!result.success) {
      return NextResponse.json({ error: "Failed to fetch prompt from Stakwork" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("Error fetching prompt:", error);
    return NextResponse.json({ error: "Failed to fetch prompt" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
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

    const body: UpdatePromptRequest = await request.json();

    if (!body.value) {
      return NextResponse.json({ error: "Value is required" }, { status: 400 });
    }

    // Update prompt via Stakwork API
    const promptUrl = `${config.STAKWORK_BASE_URL}/prompts/${id}`;

    const response = await fetch(promptUrl, {
      method: "PUT",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        value: body.value,
        description: body.description || "",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to update prompt ${id}:`, errorText);
      return NextResponse.json(
        { error: "Failed to update prompt", details: errorText },
        { status: response.status },
      );
    }

    const result: UpdatePromptResponse = await response.json();

    if (!result.success) {
      return NextResponse.json({ error: "Failed to update prompt" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("Error updating prompt:", error);
    return NextResponse.json({ error: "Failed to update prompt" }, { status: 500 });
  }
}
