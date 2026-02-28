import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

interface StakworkPrompt {
  id: number;
  name: string;
  description: string;
  usage_notation: string;
}

interface StakworkPromptsResponse {
  success: boolean;
  data: {
    total: number;
    size: number;
    prompts: StakworkPrompt[];
  };
}

interface CreatePromptRequest {
  name: string;
  value: string;
  description?: string;
}

interface CreatePromptResponse {
  success: boolean;
  data: string;
}

export async function GET(request: NextRequest) {
  try {
    const devMode = isDevelopmentMode();

    // In dev mode, skip authentication checks
    if (!devMode) {
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

      if (!stakworkWorkspace) {
        return NextResponse.json({ error: "Access denied - not a member of stakwork workspace" }, { status: 403 });
      }
    }

    // Get pagination and filter params
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const workflowId = searchParams.get("workflow_id");
    const includeUsages = searchParams.get("include_usages") === "true";
    const search = searchParams.get("search");

    // In dev mode, call mock API directly to avoid SSL issues
    if (devMode) {
      const { GET: mockGET } = await import("@/app/api/mock/stakwork/prompts/route");
      return mockGET(request);
    }

    // Fetch prompts from Stakwork API
    let promptsUrl = `${config.STAKWORK_BASE_URL}/prompts?page=${page}`;
    
    if (workflowId) {
      promptsUrl += `&workflow_id=${workflowId}`;
    }
    if (includeUsages) {
      promptsUrl += `&include_usages=true`;
    }
    if (search) {
      promptsUrl += `&search=${encodeURIComponent(search)}`;
    }

    const response = await fetch(promptsUrl, {
      method: "GET",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to fetch prompts from Stakwork:", errorText);
      return NextResponse.json(
        { error: "Failed to fetch prompts", details: errorText },
        { status: response.status },
      );
    }

    const result: StakworkPromptsResponse = await response.json();

    if (!result.success) {
      return NextResponse.json({ error: "Failed to fetch prompts from Stakwork" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: {
        prompts: result.data.prompts,
        total: result.data.total,
        size: result.data.size,
        page,
      },
    });
  } catch (error) {
    console.error("Error fetching prompts:", error);
    return NextResponse.json({ error: "Failed to fetch prompts" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const devMode = isDevelopmentMode();

    // In dev mode, skip authentication checks
    if (!devMode) {
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

      if (!stakworkWorkspace) {
        return NextResponse.json({ error: "Access denied - not a member of stakwork workspace" }, { status: 403 });
      }
    }

    const body: CreatePromptRequest = await request.json();

    if (!body.name || !body.value) {
      return NextResponse.json({ error: "Name and value are required" }, { status: 400 });
    }

    // Create prompt via Stakwork API (or mock in dev mode)
    const promptsUrl = devMode
      ? `${request.nextUrl.origin}/api/mock/stakwork/prompts`
      : `${config.STAKWORK_BASE_URL}/prompts/`;

    const response = await fetch(promptsUrl, {
      method: "POST",
      headers: devMode ? { "Content-Type": "application/json" } : {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: body.name,
        value: body.value,
        description: body.description || "",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to create prompt:", errorText);
      return NextResponse.json(
        { error: "Failed to create prompt", details: errorText },
        { status: response.status },
      );
    }

    const result: CreatePromptResponse = await response.json();

    if (!result.success) {
      return NextResponse.json({ error: "Failed to create prompt" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("Error creating prompt:", error);
    return NextResponse.json({ error: "Failed to create prompt" }, { status: 500 });
  }
}
