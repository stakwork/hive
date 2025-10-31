import { authOptions } from "@/lib/auth/nextauth";
import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { getS3Service } from "@/services/s3";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Helper function to extract S3 key from media_url
function extractS3KeyFromUrl(url: string): string | null {
  try {
    // Check if it's a sphinx-livekit-recordings URL
    if (url.includes('sphinx-livekit-recordings.s3.amazonaws.com')) {
      const urlObj = new URL(url);
      // Remove leading slash from pathname to get the S3 key
      return urlObj.pathname.substring(1);
    }
    return null;
  } catch {
    return null;
  }
}

// Helper function to process nodes and presign media_url fields
async function processNodesMediaUrls(nodes: any[], s3Service: any): Promise<any[]> {
  const processedNodes = [];

  for (const node of nodes) {
    const processedNode = { ...node };

    // Check if node has properties.media_url
    if (node.properties?.media_url && typeof node.properties.media_url === 'string') {
      const s3Key = extractS3KeyFromUrl(node.properties.media_url);
      if (s3Key) {
        try {
          // Generate presigned URL with 1 hour expiration
          const presignedUrl = await s3Service.generatePresignedDownloadUrlForBucket(
            'sphinx-livekit-recordings',
            s3Key,
            3600
          );
          processedNode.properties = {
            ...node.properties,
            media_url: presignedUrl
          };
          console.log(`[Jarvis Nodes] Presigned media_url for node ${node.ref_id}: ${s3Key}`);
        } catch (error) {
          console.error(`[Jarvis Nodes] Failed to presign media_url for node ${node.ref_id}:`, error);
          // Keep original URL if presigning fails
        }
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

    console.log('endpoint');
    console.log(endpoint);
    console.log('endpoint-end');

    const where: Record<string, string> = {};
    if (workspaceId) where.workspaceId = workspaceId;

    const swarm = await db.swarm.findFirst({ where });
    if (!swarm) {
      return NextResponse.json({ success: false, message: "Swarm not found" }, { status: 404 });
    }
    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return NextResponse.json({ success: false, message: "Swarm URL or API key not set" }, { status: 400 });
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
    if (apiResult.ok && apiResult?.data?.nodes) {
      try {
        const s3Service = getS3Service();
        // Only process the nodes array, keep edges and other data unchanged
        const processedNodes = await processNodesMediaUrls(apiResult.data.nodes, s3Service);
        processedData = {
          ...apiResult.data,
          nodes: processedNodes
        };
        console.log('[Jarvis Nodes] Successfully processed media URLs in nodes');
      } catch (error) {
        console.error('[Jarvis Nodes] Error processing media URLs:', error);
        // Continue with original data if processing fails
      }
    }

    return NextResponse.json(
      {
        success: apiResult.ok,
        status: apiResult.status,
        data: processedData,
      },
      { status: apiResult.status },
    );
  } catch (error) {
    console.error("Nodes fetch error:", error);
    return NextResponse.json({ success: false, message: "Failed to get nodes" }, { status: 500 });
  }
}
