import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { config } from "@/lib/env";
import { db } from "@/lib/db";
import { getWorkspaceById } from "@/services/workspace";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { EncryptionService } from "@/lib/encryption";
import { getBaseUrl } from "@/lib/utils";

export const runtime = "nodejs";

// Disable caching for real-time messaging
export const fetchCache = "force-no-store";

const encryptionService: EncryptionService = EncryptionService.getInstance();

async function callStakworkAPI(params: {
  message: string;
  userName: string | null;
  accessToken: string | null;
  swarmUrl: string;
  swarmSecretAlias: string | null;
  poolName: string | null;
  repo2GraphUrl: string;
  workspaceId: string;
}) {
  const { 
    message, 
    userName, 
    accessToken, 
    swarmUrl, 
    swarmSecretAlias, 
    poolName, 
    repo2GraphUrl,
    workspaceId
  } = params;

  if (!config.STAKWORK_API_KEY || !config.STAKWORK_USER_JOURNEY_WORKFLOW_ID) {
    throw new Error("Stakwork configuration missing for user journey");
  }

  // Build webhook URLs
  const appBaseUrl = getBaseUrl();
  const webhookUrl = `${appBaseUrl}/api/stakwork/user-journey/webhook`;
  const workflowWebhookUrl = `${appBaseUrl}/api/stakwork/webhook?workspace_id=${workspaceId}`;

  // Build vars object with all required fields
  const vars = {
    message,
    webhookUrl,
    alias: userName,
    username: userName,
    accessToken,
    swarmUrl,
    swarmSecretAlias,
    poolName,
    repo2graph_url: repo2GraphUrl,
  };

  // Build Stakwork payload
  const stakworkPayload = {
    name: "hive_user_journey",
    workflow_id: parseInt(config.STAKWORK_USER_JOURNEY_WORKFLOW_ID),
    webhook_url: workflowWebhookUrl,
    workflow_params: {
      set_var: {
        attributes: {
          vars,
        },
      },
    },
  };

  // Make Stakwork API call
  const response = await fetch(`${config.STAKWORK_BASE_URL}/projects`, {
    method: "POST",
    body: JSON.stringify(stakworkPayload),
    headers: {
      Authorization: `Token token=${config.STAKWORK_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    console.error(`Failed to send message to Stakwork: ${response.statusText}`);
    return { success: false, error: response.statusText };
  }

  const result = await response.json();
  return { success: result.success, data: result.data };
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

    // Get user details including GitHub auth and accounts
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        accounts: {
          select: {
            access_token: true,
            provider: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Get GitHub auth details
    const githubAuth = await db.gitHubAuth.findUnique({ where: { userId } });
    const userName = githubAuth?.githubUsername || null;

    // Decrypt access token
    let accessToken: string | null = null;
    try {
      const accountWithToken = user.accounts.find(
        (account) => account.access_token,
      );
      if (accountWithToken?.access_token) {
        accessToken = encryptionService.decryptField(
          "access_token",
          accountWithToken.access_token,
        );
      }
    } catch (error) {
      console.error("Failed to decrypt access_token:", error);
      // Fallback to unencrypted token if decryption fails
      const accountWithToken = user.accounts.find(
        (account) => account.access_token,
      );
      accessToken = accountWithToken?.access_token || null;
    }

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

    stakworkData = await callStakworkAPI({
      message,
      userName,
      accessToken,
      swarmUrl,
      swarmSecretAlias,
      poolName,
      repo2GraphUrl,
      workspaceId: workspace.id,
    });

    return NextResponse.json(
      {
        success: true,
        message: "called stakwork",
        workflow: stakworkData?.data || null,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error calling Stakwork for user journey:", error);
    return NextResponse.json(
      { error: "Failed to call Stakwork for user journey" },
      { status: 500 },
    );
  }
}
