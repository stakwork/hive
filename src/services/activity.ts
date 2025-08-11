import { swarmGraphQuery } from "./swarm/api/swarm";
import { db } from "@/lib/db";

export interface ActivityItem {
  id: string;
  type: string;
  summary: string;
  user: string;
  timestamp: Date;
  status: string;
  metadata?: Record<string, unknown>;
}

export interface ActivityResponse {
  success: boolean;
  data: ActivityItem[];
  error?: string;
}

export async function getWorkspaceActivity(
  workspaceSlug: string,
  limit: number = 5
): Promise<ActivityResponse> {
  try {
    // Get workspace and associated swarm
    const workspace = await db.workspace.findUnique({
      where: { slug: workspaceSlug },
      include: {
        swarm: {
          where: {
            status: "ACTIVE",
            swarmUrl: { not: null },
            swarmApiKey: { not: null }
          }
        }
      }
    });

    if (!workspace) {
      return {
        success: false,
        data: [],
        error: "Workspace not found"
      };
    }

    if (!workspace.swarm) {
      return {
        success: true,
        data: [],
        error: "No active swarm configured for this workspace"
      };
    }

    const swarm = workspace.swarm;
    
    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return {
        success: true,
        data: [],
        error: "Swarm configuration incomplete"
      };
    }

    // Query swarm graph for recent activity
    const response = await swarmGraphQuery({
      swarmUrl: swarm.swarmUrl,
      apiKey: swarm.swarmApiKey,
      nodeType: ["Episode"],
      topNodeCount: limit,
      depth: 0,
      sortBy: "date_added_to_graph"
    });

    if (!response.ok) {
      return {
        success: false,
        data: [],
        error: `Failed to fetch activity from swarm: ${response.status}`
      };
    }

    // Transform swarm response to standardized activity format
    const activities: ActivityItem[] = transformSwarmDataToActivity(response.data);

    return {
      success: true,
      data: activities
    };

  } catch (error) {
    console.error("Error fetching workspace activity:", error);
    return {
      success: false,
      data: [],
      error: "Internal server error"
    };
  }
}

function transformSwarmDataToActivity(swarmData: unknown): ActivityItem[] {
  // Transform the swarm API response to our ActivityItem format
  // The response structure is: { edges: [], nodes: [...], status: "Success" }
  if (!swarmData || typeof swarmData !== 'object') {
    return [];
  }

  const responseData = swarmData as any;
  const nodes = responseData.nodes || [];

  if (!Array.isArray(nodes)) {
    return [];
  }

  return nodes.map((node: any, index: number) => {
    const properties = node.properties || {};
    const episodeTitle = properties.episode_title || "Unknown Episode";
    
    // Convert timestamp (appears to be in seconds) to Date
    const timestamp = node.date_added_to_graph 
      ? new Date(node.date_added_to_graph * 1000) // Convert seconds to milliseconds
      : new Date();

    return {
      id: node.ref_id || `episode_${index}`,
      type: "episode",
      summary: episodeTitle,
      user: "System", // Episodes don't seem to have user info in this structure
      timestamp,
      status: "active",
      metadata: {
        nodeType: node.node_type,
        score: node.score,
        edgeCount: node.edge_count,
        mediaUrl: properties.media_url,
        sourceLink: properties.source_link,
        originalData: node
      }
    };
  });
}