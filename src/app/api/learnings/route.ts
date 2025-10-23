import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";

async function getSwarmConfig(workspaceSlug: string, userId: string) {
  const workspaceAccess = await validateWorkspaceAccess(workspaceSlug, userId);
  if (!workspaceAccess.hasAccess) {
    return { error: "Workspace not found or access denied", status: 403 };
  }

  const swarm = await db.swarm.findFirst({
    where: {
      workspaceId: workspaceAccess.workspace?.id,
    },
  });

  if (!swarm) {
    return { error: "Swarm not found for this workspace", status: 404 };
  }

  if (!swarm.swarmUrl) {
    return { error: "Swarm URL not configured", status: 404 };
  }

  const encryptionService: EncryptionService = EncryptionService.getInstance();
  const decryptedSwarmApiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey || "");

  const swarmUrlObj = new URL(swarm.swarmUrl);
  let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
  if (swarm.swarmUrl.includes("localhost")) {
    baseSwarmUrl = `http://localhost:3355`;
  }

  return { baseSwarmUrl, decryptedSwarmApiKey };
}

export async function GET(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspace");
    const question = searchParams.get("question");

    if (!workspaceSlug) {
      return NextResponse.json({ error: "Missing required parameter: workspace" }, { status: 400 });
    }

    const swarmConfig = await getSwarmConfig(workspaceSlug, userOrResponse.id);
    if ("error" in swarmConfig) {
      return NextResponse.json({ error: swarmConfig.error }, { status: swarmConfig.status });
    }

    const { baseSwarmUrl, decryptedSwarmApiKey } = swarmConfig;

    let swarmUrl = `${baseSwarmUrl}/learnings`;
    if (question) {
      swarmUrl += `?question=${encodeURIComponent(question)}`;
    }

    const response = await fetch(swarmUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": decryptedSwarmApiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Swarm server error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Learnings API proxy error:", error);
    return NextResponse.json({ error: "Failed to fetch learnings data" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspace");
    const budget = searchParams.get("budget");

    if (!workspaceSlug) {
      return NextResponse.json({ error: "Missing required parameter: workspace" }, { status: 400 });
    }

    if (!budget) {
      return NextResponse.json({ error: "Missing required parameter: budget" }, { status: 400 });
    }

    const swarmConfig = await getSwarmConfig(workspaceSlug, userOrResponse.id);
    if ("error" in swarmConfig) {
      return NextResponse.json({ error: swarmConfig.error }, { status: swarmConfig.status });
    }

    const { baseSwarmUrl, decryptedSwarmApiKey } = swarmConfig;

    const swarmUrl = `${baseSwarmUrl}/seed_stories?budget=${encodeURIComponent(budget)}`;

    fetch(swarmUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": decryptedSwarmApiKey,
      },
    })
      .then((response) => {
        if (!response.ok) {
          console.error(`Swarm seed_stories error: ${response.status}`);
        }
      })
      .catch((error) => {
        console.error("Seed stories request failed:", error);
      });

    return NextResponse.json({ success: true, message: "Seed knowledge request initiated" });
  } catch (error) {
    console.error("Seed stories API proxy error:", error);
    return NextResponse.json({ error: "Failed to seed stories" }, { status: 500 });
  }
}
