import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { triggerAsyncSync } from "@/services/swarm/stakgraph-actions";
import { getStakgraphWebhookCallbackUrl } from "@/lib/url";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const { workspaceId, swarmId } = body as {
      workspaceId?: string;
      swarmId?: string;
    };

    const where: Record<string, string> = {};
    if (swarmId) where.swarmId = swarmId;
    if (!swarmId && workspaceId) where.workspaceId = workspaceId;
    const swarm = await db.swarm.findFirst({ where });
    if (!swarm || !swarm.name || !swarm.swarmApiKey) {
      return NextResponse.json(
        { success: false, message: "Swarm not found or misconfigured" },
        { status: 400 },
      );
    }
    if (!swarm.repositoryUrl) {
      return NextResponse.json(
        { success: false, message: "Repository URL not set" },
        { status: 400 },
      );
    }

    let username: string | undefined;
    let pat: string | undefined;
    const userId = session.user.id as string;
    const creds = await getGithubUsernameAndPAT(userId);
    if (creds) {
      username = creds.username;
      pat = creds.pat;
    }

    const callbackUrl = getStakgraphWebhookCallbackUrl(request);
    const apiResult = await triggerAsyncSync(
      swarm.name,
      swarm.swarmApiKey,
      swarm.repositoryUrl,
      username && pat ? { username, pat } : undefined,
      callbackUrl,
    );

    return NextResponse.json(
      { success: apiResult.ok, status: apiResult.status },
      { status: apiResult.status },
    );
  } catch {
    return NextResponse.json(
      { success: false, message: "Failed to sync" },
      { status: 500 },
    );
  }
}
