import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { isDevelopmentMode } from "@/lib/runtime";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

type RouteParams = {
  params: Promise<{ slug: string; workflowId: string }>;
};

interface WorkflowVersion {
  workflow_version_id: string;
  workflow_id: number;
  workflow_json: string;
  workflow_name?: string;
  date_added_to_graph: string;
  published_at?: string | null;
  ref_id: string;
  node_type: "Workflow_version";
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    const { slug, workflowId } = await params;

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Invalid user session" },
        { status: 401 }
      );
    }

    // Check workspace exists first (before membership check)
    const workspace = await db.workspace.findFirst({
      where: { slug, deleted: false },
      include: {
        swarm: {
          select: {
            id: true,
            swarmUrl: true,
            swarmApiKey: true,
          },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { success: false, error: "Workspace not found" },
        { status: 404 }
      );
    }

    // Check if user is a member of the workspace
    const membership = await db.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId,
        },
      },
    });

    if (!membership) {
      return NextResponse.json(
        { success: false, error: "Access denied" },
        { status: 403 }
      );
    }

    // Validate workflowId is a valid number
    const workflowIdNum = parseInt(workflowId, 10);
    if (isNaN(workflowIdNum)) {
      return NextResponse.json(
        { success: false, error: "Invalid workflow ID" },
        { status: 400 }
      );
    }

    const swarm = await db.swarm.findUnique({
      where: { workspaceId: workspace.id },
    });

    if (!swarm) {
      return NextResponse.json(
        { success: false, error: "Swarm configuration not found for this workspace" },
        { status: 404 }
      );
    }

    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return NextResponse.json(
        { success: false, error: "Swarm not configured properly" },
        { status: 400 }
      );
    }

    const devMode = isDevelopmentMode();
    const swarmUrlObj = new URL(swarm.swarmUrl);
    const protocol = swarmUrlObj.hostname.includes("localhost") ? "http" : "https";
    let graphUrl = `${protocol}://${swarmUrlObj.hostname}:3355`;
    let apiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);

    // Use environment variables for Stakwork workspace or dev mode
    if (
      devMode ||
      (workspace.id === process.env.STAKWORK_WORKSPACE_ID &&
        process.env.STAKWORK_GRAPH_URL &&
        process.env.STAKWORK_GRAPH_API_KEY)
    ) {
      graphUrl = process.env.STAKWORK_GRAPH_URL ?? graphUrl;
      apiKey = process.env.STAKWORK_GRAPH_API_KEY ?? apiKey;
    }

    // Call graph API to search for Workflow_version nodes
    const apiResult = await fetch(`${graphUrl}/api/graph/search/attributes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": apiKey,
      },
      body: JSON.stringify({
        top_node_count: 10,
        node_type: ["Workflow_version"],
        include_properties: true,
        limit: 10,
        skip: 0,
        skip_cache: true,
        search_filters: [
          {
            attribute: "workflow_id",
            value: workflowIdNum,
            comparator: "=",
          },
        ],
      }),
    });

    if (!apiResult.ok) {
      const errorData = await apiResult.json().catch(() => ({}));
      return NextResponse.json(
        {
          success: false,
          error: "Failed to fetch workflow versions from graph API",
          details: errorData,
        },
        { status: 500 }
      );
    }

    const data = await apiResult.json();
    const nodes = Array.isArray(data) ? data : [];

    // Map nodes to WorkflowVersion structure
    const versions: WorkflowVersion[] = nodes
      .filter(
        (node: any) =>
          node.node_type === "Workflow_version" &&
          node.properties?.workflow_version_id &&
          node.properties?.workflow_json
      )
      .map((node: any) => ({
        workflow_version_id: node.properties.workflow_version_id,
        workflow_id: node.properties.workflow_id,
        workflow_json: node.properties.workflow_json,
        workflow_name: node.properties.workflow_name,
        date_added_to_graph: node.properties.date_added_to_graph || node.date_added_to_graph,
        published_at: node.properties.published_at || null,
        ref_id: node.ref_id,
        node_type: "Workflow_version" as const,
      }));

    // Sort by date_added_to_graph descending (newest first)
    versions.sort((a, b) => {
      const dateA = new Date(a.date_added_to_graph).getTime();
      const dateB = new Date(b.date_added_to_graph).getTime();
      return dateB - dateA;
    });

    // Return up to 10 versions
    const limitedVersions = versions.slice(0, 10);

    return NextResponse.json(
      { success: true, data: { versions: limitedVersions } },
      { status: 200 }
    );
  } catch (error) {
    console.error("[Workflow Versions] GET error:", error);
    console.error("[Workflow Versions] Error stack:", error instanceof Error ? error.stack : "No stack trace");
    return NextResponse.json(
      { success: false, error: "Failed to fetch workflow versions" },
      { status: 500 }
    );
  }
}
