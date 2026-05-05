import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const DEFAULT_TOKEN_TTL = "1h";

function handleSwarmAccessError(errorType: string) {
  const statusMap: Record<string, { message: string; status: number }> = {
    WORKSPACE_NOT_FOUND: { message: "Workspace not found", status: 404 },
    ACCESS_DENIED: { message: "Access denied", status: 403 },
    SWARM_NOT_CONFIGURED: {
      message: "Swarm not configured or not active",
      status: 400,
    },
    SWARM_NOT_ACTIVE: {
      message: "Swarm not configured or not active",
      status: 400,
    },
    SWARM_NAME_MISSING: { message: "Swarm name not found", status: 400 },
    SWARM_API_KEY_MISSING: {
      message: "Swarm API key not configured",
      status: 400,
    },
  };

  const mapped = statusMap[errorType] || {
    message: "Swarm access error",
    status: 500,
  };

  return NextResponse.json({ error: mapped.message }, { status: mapped.status });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;
    const swarmAccess = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccess.success) {
      return handleSwarmAccessError(swarmAccess.error.type);
    }

    const baseUrl = transformSwarmUrlToRepo2Graph(swarmAccess.data.swarmUrl);
    const tokenResponse = await fetch(`${baseUrl}/mint-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": swarmAccess.data.swarmApiKey,
      },
      body: JSON.stringify({ expires_in: DEFAULT_TOKEN_TTL }),
      cache: "no-store",
    });

    if (!tokenResponse.ok) {
      return NextResponse.json({ error: "Failed to mint stakgraph sessions token" }, { status: 502 });
    }

    const tokenData = (await tokenResponse.json()) as {
      token?: string;
      expires_in?: string;
    };

    if (!tokenData.token) {
      return NextResponse.json({ error: "Stakgraph did not return a sessions token" }, { status: 502 });
    }

    const url = new URL("/sessions/", baseUrl);
    url.searchParams.set("token", tokenData.token);

    return NextResponse.json(
      {
        url: url.toString(),
        expiresIn: tokenData.expires_in ?? DEFAULT_TOKEN_TTL,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    console.error("Error creating stakgraph sessions embed URL:", error);
    return NextResponse.json({ error: "Failed to create stakgraph sessions embed URL" }, { status: 500 });
  }
}
