import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/lib/env";
import { EncryptionService } from "@/lib/encryption";
import { type ApiError } from "@/types";
import {
  getSwarmPoolApiKeyFor,
  updateSwarmPoolApiKeyFor,
} from "@/services/swarm/secrets";

const encryptionService: EncryptionService = EncryptionService.getInstance();

interface PodRes {
  success: boolean;
  workspace: Workspace;
}
interface Workspace {
  branches: string[];
  created: string;
  customImage: boolean;
  flagged_for_recreation: boolean;
  fqdn: string;
  id: string;
  image: string;
  marked_at: string;
  password: string;
  portMappings: Record<string, string>;
  primaryRepo: string;
  repoName: string;
  repositories: string[];
  state: string;
  subdomain: string;
  url: string;
  usage_status: string;
  useDevContainer: boolean;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
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

    const { workspaceId } = await params;

    // Validate required fields
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Missing required field: workspaceId" },
        { status: 400 },
      );
    }

    // Verify user has access to the workspace
    const workspace = await db.workspace.findFirst({
      where: { id: workspaceId },
      include: {
        owner: true,
        members: {
          where: { userId },
          select: { role: true },
        },
        swarm: true,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      );
    }

    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Check if workspace has a swarm
    if (!workspace.swarm) {
      return NextResponse.json(
        { error: "No swarm found for this workspace" },
        { status: 404 },
      );
    }

    let poolApiKey = workspace.swarm.poolApiKey;
    const swarm = workspace.swarm;
    if (!swarm.poolApiKey) {
      await updateSwarmPoolApiKeyFor(swarm.id);
      poolApiKey = await getSwarmPoolApiKeyFor(swarm.id);
    }

    // Check if swarm has pool configuration
    if (!workspace.swarm.poolName || !poolApiKey) {
      return NextResponse.json(
        { error: "Swarm not properly configured with pool information" },
        { status: 400 },
      );
    }

    // Call Pool Manager API to claim pod
    const poolName = workspace.swarm.poolName;
    const poolApiKeyPlain = encryptionService.decryptField(
      "poolApiKey",
      poolApiKey,
    );

    const url = `${config.POOL_MANAGER_BASE_URL}/pools/${encodeURIComponent(poolName)}/workspace`;
    const headers = {
      Authorization: `Bearer ${poolApiKeyPlain}`,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method: "GET",
      headers: headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Pool Manager API error: ${response.status} - ${errorText}`,
      );
      throw new Error(`Failed to claim pod: ${response.status}`);
    }

    const data: PodRes = await response.json();

    console.log(">>> data", data);

    const appMappings = Object.entries(data.workspace.portMappings).filter(
      ([key]) => key !== "15552" && key !== "15553",
    );

    console.log(">>> appMappings", appMappings);

    let frontend = "";

    if (appMappings.length === 1) {
      frontend = appMappings[0][1];
    } else {
      for (const [key, value] of appMappings) {
        console.log(">>> key", key);
        console.log(">>> value", value);
        if (key === "3000") {
          frontend = value;
          break;
        }
      }
    }

    if (!frontend) {
      return NextResponse.json(
        { error: "Failed to claim pod" },
        { status: 500 },
      );
    }

    console.log(">>> frontend", frontend);

    return NextResponse.json(
      {
        success: true,
        message: "Pod claimed successfully",
        frontend,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error claiming pod:", error);

    // Handle ApiError specifically
    if (error && typeof error === "object" && "status" in error) {
      const apiError = error as ApiError;
      return NextResponse.json(
        {
          error: apiError.message,
          service: apiError.service,
          details: apiError.details,
        },
        { status: apiError.status },
      );
    }

    return NextResponse.json({ error: "Failed to claim pod" }, { status: 500 });
  }
}
