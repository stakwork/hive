import { NextRequest, NextResponse } from "next/server";

const MOCK_CONTAINERS = [
  { name: "sphinx", status: "running", image: "sphinxlightning/sphinx-relay:latest" },
  { name: "neo4j", status: "running", image: "neo4j:5" },
  { name: "lnd", status: "stopped", image: "lightninglabs/lnd:v0.18" },
];

const MOCK_RESPONSES: Record<string, unknown> = {
  ListContainers: { containers: MOCK_CONTAINERS },
  StartContainer: { success: true },
  StopContainer: { success: true },
  RestartContainer: { success: true },
  GetContainerLogs: {
    logs: "[mock] 2026-01-01 00:00:00 Container started\n[mock] 2026-01-01 00:00:01 Listening on port 3000",
  },
  UpdateSwarm: { success: true, message: "Swarm updated" },
  GetConfig: { config: { version: "1.0.0", network: "regtest" } },
  UpdateNode: { success: true },
  ListVersions: { versions: ["v1.0.0", "v1.1.0", "v1.2.0"] },
  GetAllImageActualVersion: {
    images: {
      "sphinxlightning/sphinx-relay": "latest",
      neo4j: "5",
      "lightninglabs/lnd": "v0.18",
    },
  },
};

/**
 * Mock endpoint for swarm cmd dispatch
 * GET /api/mock/swarm-super-admin/api/cmd?tag=<tag>&txt=<json>
 */
export async function GET(request: NextRequest) {
  // 1. Validate x-jwt header (accept any non-empty value in mock mode)
  const jwt = request.headers.get("x-jwt");
  if (!jwt) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse txt query param to extract cmd
  const txt = new URL(request.url).searchParams.get("txt");
  if (!txt) {
    return NextResponse.json({ error: "Missing txt param" }, { status: 400 });
  }

  let parsed: { cmd?: string };
  try {
    parsed = JSON.parse(txt);
  } catch {
    return NextResponse.json({ error: "Invalid JSON in txt param" }, { status: 400 });
  }

  const cmd = parsed.cmd;
  if (!cmd || !(cmd in MOCK_RESPONSES)) {
    return NextResponse.json({ error: `Unknown cmd: ${cmd}` }, { status: 400 });
  }

  return NextResponse.json(MOCK_RESPONSES[cmd]);
}
