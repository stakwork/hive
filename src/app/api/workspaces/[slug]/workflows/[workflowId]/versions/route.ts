import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { isDevelopmentMode } from "@/lib/runtime";
import { getWorkflowJsonFromNode } from "@/lib/workflow/get-workflow-json-from-node";

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

    let userId = (session?.user as { id?: string })?.id ?? null;

    if (!userId) {
      const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET! });
      if (token?.id && typeof token.id === "string") {
        userId = token.id;
      }
    }

    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const workspace = await db.workspace.findFirst({
      where: { slug, deleted: false },
      include: {
        owner: true,
        members: {
          where: { userId, leftAt: null },
          select: { role: true },
        },
        swarm: true,
        repositories: true,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { success: false, error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    // IDOR guard: the handler loaded `members` filtered by userId but
    // never checked `members.length` or `ownerId`, so any signed-in
    // user could read workflow_version nodes (including raw
    // workflow_json) from any workspace slug via the victim's
    // decrypted swarmApiKey. Require active ownership or membership
    // before decrypting credentials or calling the graph API.
    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.length > 0;
    if (!isOwner && !isMember) {
      return NextResponse.json(
        { success: false, error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    // Validate workflowId is a valid number
    const workflowIdNum = parseInt(workflowId, 10);
    if (isNaN(workflowIdNum)) {
      return NextResponse.json({ success: false, error: "Invalid workflow ID" }, { status: 400 });
    }

    const swarm = await db.swarm.findUnique({
      where: { workspaceId: workspace.id },
    });

    if (!swarm) {
      return NextResponse.json(
        { success: false, error: "Swarm configuration not found for this workspace" },
        { status: 404 },
      );
    }

    const devMode = isDevelopmentMode();
    let graphUrl = "";
    let apiKey = "";

    if (
      devMode ||
      (workspace.id === process.env.STAKWORK_WORKSPACE_ID &&
        process.env.STAKWORK_GRAPH_URL &&
        process.env.STAKWORK_GRAPH_API_KEY)
    ) {
      graphUrl = process.env.STAKWORK_JARVIS_URL ?? graphUrl;
      apiKey = process.env.STAKWORK_GRAPH_API_KEY ?? apiKey;
    } else {
      if (!swarm.swarmUrl || !swarm.swarmApiKey) {
        return NextResponse.json({ success: false, error: "Swarm not configured properly" }, { status: 400 });
      }

      const swarmUrlObj = new URL(swarm.swarmUrl);
      const protocol = swarmUrlObj.hostname.includes("localhost") ? "http" : "https";

      graphUrl = `${protocol}://${swarmUrlObj.hostname}:3355`;
      apiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);
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
        sort_by: "workflow_version_id",
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
        { status: 500 },
      );
    }

    const data = await apiResult.json();
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];

    // Map nodes to WorkflowVersion structure
    const versions: WorkflowVersion[] = nodes
      .filter((node: any) => node.properties?.workflow_version_id && getWorkflowJsonFromNode(node))
      .map((node: any) => ({
        workflow_version_id: String(node.properties.workflow_version_id),
        workflow_id: node.properties.workflow_id,
        workflow_json: getWorkflowJsonFromNode(node),
        workflow_name: node.properties.workflow_name,
        date_added_to_graph: node.properties.date_added_to_graph || node.date_added_to_graph,
        published: node.properties.published,
        published_at: node.properties.published_at || null,
        ref_id: node.ref_id,
        node_type: "Workflow_version" as const,
      }));

    // Resolve workflow_name: propagate from any version that has it,
    // or fall back to the parent Workflow node.
    const resolvedName =
      versions.find((v) => v.workflow_name)?.workflow_name ??
      (await fetchWorkflowNodeName(graphUrl, apiKey, workflowIdNum));

    const versionsWithName = versions.map((v) => ({
      ...v,
      workflow_name: v.workflow_name ?? resolvedName,
    }));

    // Sort by workflow_version_id descending (newest first)
    versionsWithName.sort((a, b) => Number(b.workflow_version_id) - Number(a.workflow_version_id));

    // Return up to 10 versions
    const limitedVersions = versionsWithName.slice(0, 10);

    return NextResponse.json({ success: true, data: { versions: limitedVersions } }, { status: 200 });
  } catch (error) {
    console.error("[Workflow Versions] GET error:", error);
    console.error("[Workflow Versions] Error stack:", error instanceof Error ? error.stack : "No stack trace");
    return NextResponse.json({ success: false, error: "Failed to fetch workflow versions" }, { status: 500 });
  }
}

async function fetchWorkflowNodeName(
  graphUrl: string,
  apiKey: string,
  workflowId: number,
): Promise<string | undefined> {
  try {
    const res = await fetch(`${graphUrl}/api/graph/search/attributes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": apiKey,
      },
      body: JSON.stringify({
        top_node_count: 1,
        node_type: ["Workflow"],
        include_properties: true,
        limit: 1,
        skip: 0,
        skip_cache: true,
        search_filters: [
          { attribute: "workflow_id", value: workflowId, comparator: "=" },
        ],
      }),
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return (data.nodes?.[0]?.properties?.workflow_name as string | undefined) ?? undefined;
  } catch {
    return undefined;
  }
}
