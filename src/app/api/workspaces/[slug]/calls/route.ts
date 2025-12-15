import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getJarvisUrl } from "@/lib/utils/swarm";
import {
  CallRecording,
  CallsResponse,
  JarvisSearchResponse,
} from "@/types/calls";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 },
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "10", 10);
    const skip = parseInt(searchParams.get("skip") || "0", 10);

    // Get workspace swarm access with decrypted credentials
    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);

    if (!swarmAccessResult.success) {
      const { error } = swarmAccessResult;
      
      if (error.type === "WORKSPACE_NOT_FOUND") {
        return NextResponse.json(
          { error: "Workspace not found" },
          { status: 404 },
        );
      }
      
      if (error.type === "ACCESS_DENIED") {
        return NextResponse.json(
          { error: "Access denied" },
          { status: 403 },
        );
      }
      
      if (error.type === "SWARM_NOT_ACTIVE") {
        return NextResponse.json(
          { error: "Swarm not configured or not active" },
          { status: 400 },
        );
      }
      
      if (error.type === "SWARM_NAME_MISSING") {
        return NextResponse.json(
          { error: "Swarm name not found" },
          { status: 400 },
        );
      }
      
      if (error.type === "SWARM_API_KEY_MISSING") {
        return NextResponse.json(
          { error: "Swarm API key not configured" },
          { status: 400 },
        );
      }
      
      // SWARM_NOT_CONFIGURED
      return NextResponse.json(
        { error: "Swarm not configured or not active" },
        { status: 400 },
      );
    }

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);

    const jarvisResponse = await fetch(
      `${jarvisUrl}/graph/nodes/list?node_type=%5B%22Episode%22%2C%22Call%22%5D&sort_by=date_added_to_graph&order_by=desc&limit=${limit + 1}&skip=${skip}`,
      {
        method: "GET",
        headers: {
          "x-api-token": swarmApiKey,
        },
      }
    );

    if (!jarvisResponse.ok) {
      console.error(
        `Jarvis API error: ${jarvisResponse.status} ${jarvisResponse.statusText}`,
      );
      return NextResponse.json(
        { error: "Failed to fetch call recordings." },
        { status: 502 },
      );
    }

    const jarvisData: JarvisSearchResponse = await jarvisResponse.json();

    const allCalls: CallRecording[] = jarvisData.nodes.map((node) => ({
      ref_id: node.ref_id,
      episode_title: node.properties.episode_title,
      date_added_to_graph: node.date_added_to_graph,
      description: node.properties.description,
    }));

    const hasMore = allCalls.length > limit;
    const calls = hasMore ? allCalls.slice(0, limit) : allCalls;
    const total = calls.length;

    const response: CallsResponse = {
      calls,
      total,
      hasMore,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching calls:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
