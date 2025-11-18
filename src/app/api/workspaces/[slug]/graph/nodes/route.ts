import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getS3Service } from "@/services/s3";
import { getWorkspaceBySlug } from "@/services/workspace";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

// Helper function to extract S3 key from media_url (matching jarvis/nodes logic)
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
  nodes: any[],
  s3Service: ReturnType<typeof getS3Service>,
): Promise<any[]> {
  const processedNodes = [];

  for (const node of nodes) {
    const processedNode = { ...node };

    // Check if node has properties.media_url and if it's an S3 URL
    if (node.properties?.media_url && typeof node.properties.media_url === "string") {
      // Only presign if it's a sphinx-livekit-recordings URL
      if (node.properties.media_url.includes("sphinx-livekit-recordings")) {
        try {
          const s3Key = extractS3KeyFromUrl(node.properties.media_url);

          // Generate presigned URL with 1 hour expiration
          const presignedUrl = await s3Service.generatePresignedDownloadUrlForBucket(
            "sphinx-livekit-recordings",
            s3Key,
            3600,
          );

          processedNode.properties = {
            ...node.properties,
            media_url: presignedUrl,
          };
        } catch (error) {
          // Keep original URL if presigning fails
        }
      }
    }

    processedNodes.push(processedNode);
  }

  return processedNodes;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const { slug } = await params;

    if (!session?.user) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ success: false, message: "Invalid user session" }, { status: 401 });
    }

    // Get workspace and verify user has access
    const workspace = await getWorkspaceBySlug(slug, userId);
    if (!workspace) {
      return NextResponse.json({ success: false, message: "Workspace not found or access denied" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const nodeType = searchParams.get("node_type");
    const refIds = searchParams.get("ref_ids");
    const output = searchParams.get("output") || "json";
    const limit = searchParams.get("limit") || "100";
    const limitMode = searchParams.get("limit_mode") || "per_type";


    // Get swarm for this workspace
    const swarm = await db.swarm.findUnique({
      where: { workspaceId: workspace.id },
    });

    if (!swarm) {
      return NextResponse.json({ success: false, message: "Swarm not found for this workspace" }, { status: 404 });
    }

    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return NextResponse.json({ success: false, message: "Swarm configuration is incomplete" }, { status: 400 });
    }

    // Extract hostname from swarm URL and construct graph endpoint
    const swarmUrlObj = new URL(swarm.swarmUrl);
    const protocol = swarmUrlObj.hostname.includes("localhost") ? "http" : "https";

    // Allow environment overrides for development/testing
    let graphUrl = `${protocol}://${swarmUrlObj.hostname}:3355`;
    let apiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);

    if (process.env.CUSTOM_SWARM_URL) {
      graphUrl = `${process.env.CUSTOM_SWARM_URL}:3355`;
    }
    if (process.env.CUSTOM_SWARM_API_KEY) {
      apiKey = process.env.CUSTOM_SWARM_API_KEY;
    }

    // Build API params based on what's provided
    const apiParams: Record<string, string> = {
      output: output,
    };

    if (nodeType) {
      // If nodeType is a JSON array string, parse it and join as comma-separated
      try {
        const parsed = JSON.parse(nodeType);
        if (Array.isArray(parsed)) {
          apiParams.node_types = parsed.join(',');
        } else {
          apiParams.node_types = nodeType;
        }
      } catch {
        // If it's not JSON, use as-is
        apiParams.node_types = nodeType;
      }
    }

    if (refIds) {
      apiParams.ref_ids = refIds;
    }

    if (limit) {
      apiParams.limit = limit;
    }

    if (limitMode) {
      apiParams.limit_mode = limitMode;
    }

    apiParams.edges = 'true';

    const apiResult = await fetch(`${graphUrl}/graph?${new URLSearchParams(apiParams).toString()}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": apiKey,
      },
    });

    if (!apiResult.ok) {
      const data = await apiResult.json();
      return NextResponse.json(
        {
          success: false,
          message: "Failed to fetch graph nodes",
          details: data,
        },
        { status: apiResult.status },
      );
    }

    const data = await apiResult.json();

    // Process the response data to presign any media_url fields in nodes
    let processedData = data;
    try {
      if (data?.nodes) {
        const s3Service = getS3Service();
        // Process nodes to presign S3 URLs
        const processedNodes = await processNodesMediaUrls(data.nodes, s3Service);
        processedData = {
          ...data,
          nodes: processedNodes,
        };
      }
    } catch (error) {
      // Continue with original data if processing fails
    }

    return NextResponse.json(
      {
        success: true,
        data: { nodes: processedData.nodes, edges: processedData.edges },
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ success: false, message: "Failed to fetch graph nodes" }, { status: 500 });
  }
}
