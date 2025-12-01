import { authOptions } from "@/lib/auth/nextauth";
import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { getS3Service } from "@/services/s3";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import type { JarvisNode, JarvisResponse } from "@/types/jarvis";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { mockData } from "./example";

export const runtime = "nodejs";


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

    console.log('request--here', request);

    const searchParams = request.nextUrl.searchParams;
    const workspaceId = searchParams.get("id");
    const endpoint = searchParams.get("endpoint") || "graph/search/latest?limit=1000&top_node_count=500";
    const nodeType = searchParams.get("node_type");

    console.log("[Jarvis Nodes] Full request URL:", request.nextUrl.toString());
    console.log("[Jarvis Nodes] Endpoint param:", endpoint);
    console.log("[Jarvis Nodes] Node type param:", nodeType);

    const where: Record<string, string> = {};
    if (workspaceId) where.workspaceId = workspaceId;

    const swarm = await db.swarm.findFirst({ where });

    // Return mock data if swarm is not configured (for development/testing)
    if (!swarm || !swarm.swarmUrl || !swarm.swarmApiKey) {
      console.log("[Jarvis Nodes] Swarm not configured, calling mock endpoint");

      // Get workspace slug from workspace ID
      let workspaceSlug = "";
      if (workspaceId) {
        const workspace = await db.workspace.findUnique({
          where: { id: workspaceId },
          select: { slug: true },
        });
        if (workspace) {
          workspaceSlug = workspace.slug;
        }
      }

      if (!workspaceSlug) {
        return NextResponse.json(
          { success: false, message: "Workspace not found" },
          { status: 404 },
        );
      }

      // Call the mock endpoint
      const baseUrl = request.nextUrl.origin;
      const mockUrl = new URL(`/api/mock/jarvis/graph`, baseUrl);
      mockUrl.searchParams.set("workspaceSlug", workspaceSlug);

      const mockResponse = await fetch(mockUrl.toString(), {
        headers: {
          Cookie: request.headers.get("cookie") || "",
        },
      });

      if (!mockResponse.ok) {
        const errorData = await mockResponse.json();
        return NextResponse.json(errorData, { status: mockResponse.status });
      }

      const mockData = await mockResponse.json();
      return NextResponse.json(mockData, { status: 200 });
    }

    const vanityAddress = getSwarmVanityAddress(swarm.name);

    let jarvisUrl = `https://${vanityAddress}:8444`;
    let apiKey = swarm.swarmApiKey;
    if (process.env.CUSTOM_SWARM_URL) jarvisUrl = `${process.env.CUSTOM_SWARM_URL}:8444`;
    if (process.env.CUSTOM_SWARM_API_KEY) apiKey = process.env.CUSTOM_SWARM_API_KEY;

    // Append node_type to endpoint if provided
    let finalEndpoint = endpoint;
    if (nodeType) {
      const separator = endpoint.includes('?') ? '&' : '?';
      finalEndpoint = `${endpoint}${separator}node_type=${nodeType}`;
    }

    console.log("[Jarvis Nodes] Jarvis URL:", jarvisUrl);
    console.log("[Jarvis Nodes] Final endpoint to swarm:", finalEndpoint);

    const apiResult = await swarmApiRequest({
      swarmUrl: jarvisUrl,
      endpoint: finalEndpoint,
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

        console.log('endpoint--here', endpoint);

        processedData = !endpoint.includes('start_date_added_to_graph') ? mockData.data : {
          ...data,
          nodes: processedNodes,
        };
        console.log("[Jarvis Nodes] Successfully processed media URLs in nodes");
      }
    } catch (error) {
      console.error("[Jarvis Nodes] Error processing media URLs:", error);
      // Continue with original data if processing fails
    }



    return NextResponse.json(
      {
        success: apiResult.ok,
        status: apiResult.status,
        data: !endpoint.includes('start_date_added_to_graph') ? mockData.data : {
          ...(processedData as JarvisResponse),
        },
      },
      { status: apiResult.status },
    );
  } catch (error) {
    console.error("Nodes fetch error:", error);
    return NextResponse.json({ success: false, message: "Failed to get nodes" }, { status: 500 });
  }
}
