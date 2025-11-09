import { authOptions } from "@/lib/auth/nextauth";
import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { getS3Service } from "@/services/s3";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import type { JarvisNode, JarvisResponse } from "@/types/jarvis";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Mock data generators for when swarm is not configured
function generateMockNodes(): JarvisNode[] {
  const nodeTypes = ["Function", "Variable", "Person", "Episode", "Clip"];
  const nodes: JarvisNode[] = [];
  const now = Date.now() / 1000; // Current time in seconds

  // Generate 50 function nodes
  for (let i = 1; i <= 50; i++) {
    nodes.push({
      ref_id: `function-${i}`,
      node_type: "Function",
      date_added_to_graph: now - Math.random() * 86400 * 30, // Random time in last 30 days
      properties: {
        name: `processData${i}`,
        description: `Function that processes data type ${i}`,
        language: "TypeScript",
      },
    });
  }

  // Generate 50 variable nodes
  for (let i = 1; i <= 50; i++) {
    nodes.push({
      ref_id: `variable-${i}`,
      node_type: "Variable",
      date_added_to_graph: now - Math.random() * 86400 * 30,
      properties: {
        name: `config${i}`,
        description: `Configuration variable ${i}`,
        type: "string",
      },
    });
  }

  // Generate 3 contributor nodes
  const contributors = ["Alice Johnson", "Bob Smith", "Charlie Davis"];
  contributors.forEach((name, i) => {
    nodes.push({
      ref_id: `person-${i + 1}`,
      node_type: "Person",
      date_added_to_graph: now - Math.random() * 86400 * 60,
      properties: {
        name,
        role: "Developer",
        contributions: Math.floor(Math.random() * 100) + 50,
      },
    });
  });

  // Generate 5 episode nodes
  const episodes = [
    "Project Kickoff Meeting",
    "Architecture Review",
    "Sprint Planning Session",
    "Code Review Discussion",
    "Deployment Strategy Meeting",
  ];
  episodes.forEach((title, i) => {
    nodes.push({
      ref_id: `episode-${i + 1}`,
      node_type: "Episode",
      date_added_to_graph: now - Math.random() * 86400 * 14,
      properties: {
        episode_title: title,
        description: `Discussion about ${title.toLowerCase()}`,
        duration: Math.floor(Math.random() * 3600) + 1800, // 30-90 minutes
      },
    });
  });

  return nodes;
}

function generateMockEdges() {
  const edges = [];

  // Connect some functions to variables
  for (let i = 1; i <= 20; i++) {
    edges.push({
      source: `function-${i}`,
      target: `variable-${i}`,
      edge_type: "uses",
    });
  }

  // Connect persons to functions (contributions)
  for (let i = 1; i <= 30; i++) {
    const personId = ((i - 1) % 3) + 1;
    edges.push({
      source: `person-${personId}`,
      target: `function-${i}`,
      edge_type: "authored",
    });
  }

  // Connect episodes to persons
  for (let i = 1; i <= 5; i++) {
    for (let j = 1; j <= 3; j++) {
      edges.push({
        source: `episode-${i}`,
        target: `person-${j}`,
        edge_type: "participant",
      });
    }
  }

  return edges;
}

// Helper function to extract S3 key from media_url (matching frontend logic)
function extractS3KeyFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const rawKey = pathname.startsWith("/") ? pathname.substring(1) : pathname;

    return decodeURIComponent(rawKey);
  } catch {
    return url;
  }
}

// Helper function to process nodes and presign media_url fields
async function processNodesMediaUrls(
  nodes: JarvisNode[],
  s3Service: ReturnType<typeof getS3Service>,
): Promise<JarvisNode[]> {
  const processedNodes = [];

  for (const node of nodes) {
    const processedNode = { ...node };

    // Check if node has properties.media_url and if it's an S3 URL
    if (node.properties?.media_url && typeof node.properties.media_url === "string") {
      console.log(`[Jarvis Nodes] Processing node ${node.ref_id} with media_url: ${node.properties.media_url}`);

      // Only presign if it's a sphinx-livekit-recordings URL
      if (node.properties.media_url.includes("sphinx-livekit-recordings")) {
        console.log(`[Jarvis Nodes] Found sphinx-livekit-recordings URL for node ${node.ref_id}`);
        try {
          const s3Key = extractS3KeyFromUrl(node.properties.media_url);
          console.log(`[Jarvis Nodes] Extracted S3 key for node ${node.ref_id}: "${s3Key}"`);

          // Generate presigned URL with 1 hour expiration
          const presignedUrl = await s3Service.generatePresignedDownloadUrlForBucket(
            "sphinx-livekit-recordings",
            s3Key,
            3600,
          );
          console.log(`[Jarvis Nodes] Generated presigned URL for node ${node.ref_id}: ${presignedUrl}`);

          processedNode.properties = {
            ...node.properties,
            media_url: presignedUrl,
          };
          console.log(`[Jarvis Nodes] Successfully presigned media_url for node ${node.ref_id}`);
        } catch (error) {
          console.error(`[Jarvis Nodes] Failed to presign media_url for node ${node.ref_id}:`, error);
          console.error(`[Jarvis Nodes] Original URL was: ${node.properties.media_url}`);
          // Keep original URL if presigning fails
        }
      } else {
        console.log(
          `[Jarvis Nodes] Skipping non-sphinx-livekit URL for node ${node.ref_id}: ${node.properties.media_url}`,
        );
      }
    }

    processedNodes.push(processedNode);
  }

  return processedNodes;
}
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const workspaceId = searchParams.get("id");
    const endpoint = searchParams.get("endpoint") || "graph/search/latest?limit=1000&top_node_count=500";

    console.log("endpoint");
    console.log(endpoint);
    console.log("endpoint-end");

    const where: Record<string, string> = {};
    if (workspaceId) where.workspaceId = workspaceId;

    const swarm = await db.swarm.findFirst({ where });

    // Return mock data if swarm is not configured (for development/testing)
    if (!swarm || !swarm.swarmUrl || !swarm.swarmApiKey) {
      console.log("[Jarvis Nodes] Swarm not configured, returning mock data");
      return NextResponse.json(
        {
          success: true,
          status: 200,
          data: {
            nodes: generateMockNodes(),
            edges: generateMockEdges(),
          },
        },
        { status: 200 },
      );
    }

    const vanityAddress = getSwarmVanityAddress(swarm.name);

    let jarvisUrl = `https://${vanityAddress}:8444`;
    let apiKey = swarm.swarmApiKey;
    if (process.env.CUSTOM_SWARM_URL) jarvisUrl = `${process.env.CUSTOM_SWARM_URL}:8444`;
    if (process.env.CUSTOM_SWARM_API_KEY) apiKey = process.env.CUSTOM_SWARM_API_KEY;

    console.log(jarvisUrl);
    console.log(endpoint);

    // console.log("jarvisUrl", jarvisUrl);
    const apiResult = await swarmApiRequest({
      swarmUrl: jarvisUrl,
      endpoint,
      method: "GET",
      apiKey,
    });

    // Process the response data to presign any media_url fields in nodes
    let processedData = apiResult.data;
    try {
      const data = apiResult.data as JarvisResponse;
      if (apiResult.ok && data?.nodes) {
        const s3Service = getS3Service();
        // Only process the nodes array, keep edges and other data unchanged
        const processedNodes = await processNodesMediaUrls(data.nodes, s3Service);
        processedData = {
          ...data,
          nodes: processedNodes,
        };
        console.log("[Jarvis Nodes] Successfully processed media URLs in nodes");
      }
    } catch (error) {
      console.error("[Jarvis Nodes] Error processing media URLs:", error);
      // Continue with original data if processing fails
    }

    const nodesDateMapped =
      (processedData as JarvisResponse).nodes?.map((node: JarvisNode) => {
        // Check if timestamp is in milliseconds (13+ digits) and convert to seconds
        const timestamp = node.date_added_to_graph;
        const isNumber = typeof timestamp === "number";
        const isMilliseconds = isNumber && timestamp.toString().length >= 13;

        return {
          ...node,
          date_added_to_graph: isMilliseconds ? timestamp / 1000 : timestamp,
        };
      }) || [];

    return NextResponse.json(
      {
        success: apiResult.ok,
        status: apiResult.status,
        data: {
          ...(processedData as JarvisResponse),
          nodes: nodesDateMapped,
        },
      },
      { status: apiResult.status },
    );
  } catch (error) {
    console.error("Nodes fetch error:", error);
    return NextResponse.json({ success: false, message: "Failed to get nodes" }, { status: 500 });
  }
}
