import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { config } from "@/lib/env";
import { db } from "@/lib/db";
import { getWorkspaceById } from "@/services/workspace";
import { type StakworkWorkflowPayload } from "@/app/api/chat/message/route";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";

export const runtime = "nodejs";

// Disable caching for real-time messaging
export const fetchCache = "force-no-store";

async function callStakwork(
  message: string,
  swarmUrl: string | null,
  swarmSecretAlias: string | null,
  poolName: string | null,
  repo2GraphUrl: string,
  accessToken: string | null,
  username: string | null,
) {
  try {
    // Validate that all required Stakwork environment variables are set
    if (!config.STAKWORK_API_KEY) {
      throw new Error("STAKWORK_API_KEY is required for Stakwork integration");
    }
    if (!config.STAKWORK_USER_JOURNEY_WORKFLOW_ID) {
      throw new Error(
        "STAKWORK_USER_JOURNEY_WORKFLOW_ID is required for this Stakwork integration",
      );
    }

    // stakwork workflow vars
    const vars = {
      message,
      accessToken,
      username,
      swarmUrl,
      swarmSecretAlias,
      poolName,
      repo2graph_url: repo2GraphUrl,
    };

    const workflowId = config.STAKWORK_USER_JOURNEY_WORKFLOW_ID || "";
    if (!workflowId) {
      throw new Error(
        "STAKWORK_USER_JOURNEY_WORKFLOW_ID is required for this Stakwork integration",
      );
    }

    const stakworkPayload: StakworkWorkflowPayload = {
      name: "hive_autogen",
      workflow_id: parseInt(workflowId),
      workflow_params: {
        set_var: {
          attributes: {
            vars,
          },
        },
      },
    };

    const stakworkURL = `${config.STAKWORK_BASE_URL}/projects`;

    const response = await fetch(stakworkURL, {
      method: "POST",
      body: JSON.stringify(stakworkPayload),
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(
        `Failed to send message to Stakwork: ${response.statusText}`,
      );
      return { success: false, error: response.statusText };
    }

    const result = await response.json();
    return { success: result.success, data: result.data };
  } catch (error) {
    console.error("Error calling Stakwork:", error);
    return { success: false, error: String(error) };
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Invalid user session" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const { message, workspaceId } = body;

    // Validate required fields
    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 },
      );
    }

    if (!workspaceId) {
      return NextResponse.json(
        { error: "Workspace ID is required" },
        { status: 400 },
      );
    }

    // Find the workspace and validate user access
    const workspace = await getWorkspaceById(workspaceId, userId);
    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    // Get user's GitHub profile (access token and username)
    const githubProfile = await getGithubUsernameAndPAT(userId);
    const accessToken = githubProfile?.pat || null;
    const username = githubProfile?.username || null;

    // Find the swarm associated with this workspace
    const swarm = await db.swarm.findUnique({
      where: { workspaceId: workspace.id },
      select: {
        id: true,
        swarmUrl: true,
        swarmSecretAlias: true,
        poolName: true,
      },
    });

    if (!swarm) {
      return NextResponse.json(
        { error: "No swarm found for this workspace" },
        { status: 404 },
      );
    }

    const swarmUrl = swarm?.swarmUrl
      ? swarm.swarmUrl.replace("/api", ":8444/api")
      : "";

    const swarmSecretAlias = swarm?.swarmSecretAlias || null;
    const poolName = swarm?.poolName || swarm?.id || null;
    const repo2GraphUrl = transformSwarmUrlToRepo2Graph(swarm?.swarmUrl);

    let stakworkData = null;

    stakworkData = await callStakwork(
      message,
      swarmUrl,
      swarmSecretAlias,
      poolName,
      repo2GraphUrl,
      accessToken,
      username,
    );

    return NextResponse.json(
      {
        success: true,
        message: "called stakwork",
        workflow: stakworkData?.data || null,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating chat message:", error);
    return NextResponse.json(
      { error: "Failed to create chat message" },
      { status: 500 },
    );
  }
}
