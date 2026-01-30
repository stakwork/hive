import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { formatEndpointLabel } from "@/lib/format-endpoint";
import { getWorkspaceChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";

export const runtime = "nodejs";

// Mock endpoint paths that match the mock graph data
const MOCK_ENDPOINTS = [
  { path: "/api/users", method: "GET" },
  { path: "/api/users", method: "POST" },
  { path: "/api/users/123", method: "GET" },
  { path: "/api/users/456", method: "PUT" },
  { path: "/api/users/789", method: "DELETE" },
  { path: "/api/auth/login", method: "POST" },
  { path: "/api/auth/logout", method: "POST" },
  { path: "/api/auth/refresh", method: "POST" },
  { path: "/api/tasks", method: "GET" },
  { path: "/api/tasks", method: "POST" },
  { path: "/api/tasks/42", method: "GET" },
  { path: "/api/tasks/99", method: "PATCH" },
  { path: "/api/workspaces", method: "GET" },
  { path: "/api/workspaces/my-workspace", method: "GET" },
  { path: "/api/graph/nodes", method: "GET" },
];

const STATUS_CODES = [200, 200, 200, 200, 201, 204, 400, 401, 404, 500];
const REGIONS = ["iad1", "sfo1", "cdg1", "hnd1", "syd1"];

function generateMockLogEntry(index: number) {
  const endpoint = MOCK_ENDPOINTS[Math.floor(Math.random() * MOCK_ENDPOINTS.length)];
  const statusCode = STATUS_CODES[Math.floor(Math.random() * STATUS_CODES.length)];
  const region = REGIONS[Math.floor(Math.random() * REGIONS.length)];

  return {
    id: `log-${Date.now()}-${index}`,
    message: `${endpoint.method} ${endpoint.path} ${statusCode}`,
    timestamp: Date.now(),
    source: "lambda" as const,
    projectId: "prj_mock123",
    deploymentId: "dpl_mock456",
    host: "my-app.vercel.app",
    path: endpoint.path,
    method: endpoint.method,
    statusCode,
    clientIp: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    proxy: {
      timestamp: Date.now(),
      method: endpoint.method,
      scheme: "https",
      host: "my-app.vercel.app",
      path: endpoint.path,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      referer: "",
      statusCode,
      clientIp: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      region,
    },
  };
}



/**
 * Map a request path to a mock endpoint node ref_id
 */
function matchPathToEndpointId(path: string): string | null {
  // Normalize path by replacing dynamic segments with :param
  const normalizedPath = path.replace(/\/\d+/g, "/:id").replace(/\/[a-z0-9-]+$/i, (match) => {
    // Keep known static segments, replace others with :param
    const knownSegments = ["users", "auth", "login", "logout", "refresh", "tasks", "workspaces", "graph", "nodes"];
    const segment = match.slice(1);
    return knownSegments.includes(segment) ? match : "/:slug";
  });

  // Find matching endpoint index
  const endpointIndex = MOCK_ENDPOINTS.findIndex((e) => {
    const endpointNormalized = e.path.replace(/:id/g, "/:id").replace(/:slug/g, "/:slug");
    return endpointNormalized === normalizedPath || e.path === path;
  });

  if (endpointIndex === -1) {
    // Try a simpler match - just the base path
    const basePath = path.split("/").slice(0, 3).join("/");
    const baseIndex = MOCK_ENDPOINTS.findIndex((e) => e.path.startsWith(basePath));
    if (baseIndex !== -1) {
      return `endpoint-${baseIndex + 1}`;
    }
    return null;
  }

  return `endpoint-${endpointIndex + 1}`;
}

/**
 * POST /api/mock/vercel/log-drain?workspace=<slug>
 *
 * Simulates Vercel log drain by generating mock logs and broadcasting highlights.
 * Query params:
 * - workspace: workspace slug (required)
 * - count: number of logs to generate (default: 1, max: 10)
 * - continuous: if "true", generates logs every 2 seconds for 30 seconds
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspace");
    const count = Math.min(parseInt(searchParams.get("count") || "1", 10), 10);
    const continuous = searchParams.get("continuous") === "true";

    if (!workspaceSlug) {
      return NextResponse.json({ error: "workspace query parameter required" }, { status: 400 });
    }

    // Verify workspace exists
    const workspace = await db.workspace.findFirst({
      where: {
        slug: workspaceSlug,
        deleted: false,
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const channelName = getWorkspaceChannelName(workspaceSlug);
    const logs = [];
    const highlights = [];

    // Generate mock logs
    for (let i = 0; i < count; i++) {
      const logEntry = generateMockLogEntry(i);
      logs.push(logEntry);

      // Match to endpoint and broadcast highlight
      const nodeRefId = matchPathToEndpointId(logEntry.path!);
      if (nodeRefId) {
        const eventPayload = {
          nodeIds: [nodeRefId],
          workspaceId: workspaceSlug,
          depth: 1,
          title: formatEndpointLabel(logEntry.path!),
          timestamp: Date.now(),
          sourceNodeRefId: nodeRefId,
          expiresIn: 10,
        };

        await pusherServer.trigger(channelName, PUSHER_EVENTS.HIGHLIGHT_NODES, eventPayload);
        highlights.push({ path: logEntry.path, nodeRefId });
      }
    }

    // If continuous mode, schedule more logs (fire and forget)
    if (continuous) {
      // Start background log generation (non-blocking)
      generateContinuousLogs(workspaceSlug, channelName);
    }

    return NextResponse.json({
      success: true,
      generated: logs.length,
      highlighted: highlights.length,
      highlights,
      continuous,
      logs,
    });
  } catch (error) {
    console.error("[Mock Vercel Logs] Error:", error);
    return NextResponse.json({ error: "Failed to generate mock logs" }, { status: 500 });
  }
}

/**
 * Generate logs continuously for 30 seconds (non-blocking)
 */
async function generateContinuousLogs(workspaceSlug: string, channelName: string) {
  const duration = 30000; // 30 seconds
  const interval = 2000; // every 2 seconds
  const startTime = Date.now();

  const generateLog = async () => {
    if (Date.now() - startTime > duration) {
      return; // Stop after duration
    }

    const logEntry = generateMockLogEntry(0);
    const nodeRefId = matchPathToEndpointId(logEntry.path!);

    if (nodeRefId) {
      const eventPayload = {
        nodeIds: [nodeRefId],
        workspaceId: workspaceSlug,
        depth: 1,
        title: formatEndpointLabel(logEntry.path!),
        timestamp: Date.now(),
        sourceNodeRefId: nodeRefId,
        expiresIn: 10,
      };

      try {
        await pusherServer.trigger(channelName, PUSHER_EVENTS.HIGHLIGHT_NODES, eventPayload);
      } catch (err) {
        console.error("[Mock Vercel Logs] Failed to broadcast:", err);
      }
    }

    // Schedule next log
    setTimeout(generateLog, interval);
  };

  // Start the first log after a delay
  setTimeout(generateLog, interval);
}

/**
 * GET /api/mock/vercel/log-drain?workspace=<slug>
 *
 * Returns info about the mock endpoint and sample log data
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceSlug = searchParams.get("workspace");

  return NextResponse.json({
    description: "Mock Vercel Log Drain endpoint for testing",
    usage: {
      method: "POST",
      url: `/api/mock/vercel/log-drain?workspace=${workspaceSlug || "<workspace-slug>"}`,
      queryParams: {
        workspace: "Required - workspace slug",
        count: "Optional - number of logs to generate (1-10, default: 1)",
        continuous: "Optional - if 'true', generates logs every 2s for 30s",
      },
    },
    sampleEndpoints: MOCK_ENDPOINTS,
    sampleLog: generateMockLogEntry(0),
  });
}
