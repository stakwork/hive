import { NextRequest, NextResponse } from "next/server";
import {
  mockIsPublic,
  mockEndpoints,
  setMockIsPublic,
  setMockEndpoints,
} from "./state";

const MOCK_CONTAINERS = [
  { name: "sphinx", status: "running", image: "sphinxlightning/sphinx-relay:latest" },
  { name: "neo4j", status: "running", image: "neo4j:5" },
  { name: "lnd", status: "stopped", image: "lightninglabs/lnd:v0.18" },
];

// ---------------------------------------------------------------------------
// Static responses
// ---------------------------------------------------------------------------
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
  // Boltwall admin
  GetBoltwallSuperAdmin: { pubkey: null, name: null },
  ListAdmins: { admins: [] },
  GetBotBalance: { balance: 0 },
  CreateBotInvoice: { invoice: "lnbcrt1mock000000000" },
  AddBoltwallUser: { success: true },
  AddBoltwallAdminPubkey: { success: true },
  DeleteSubAdmin: { success: true },
  UpdateUser: { success: true },
  GetEnrichedBoltwallUsers: { users: [] },
  UpdateNeo4jConfig: { success: true },
  UpdateEnv: { success: true },
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

  let parsed: { type?: string; cmd?: string; data?: { cmd?: string; content?: unknown }; content?: unknown };
  try {
    parsed = JSON.parse(txt);
  } catch {
    return NextResponse.json({ error: "Invalid JSON in txt param" }, { status: 400 });
  }

  // SwarmCmd shape: { type: "Swarm", data: { cmd: "..." } }
  // Fall back to top-level .cmd for legacy callers
  const cmd = parsed.data?.cmd ?? parsed.cmd;
  const content = parsed.data?.content ?? parsed.content;

  if (!cmd) {
    return NextResponse.json({ error: "Unknown cmd: undefined" }, { status: 400 });
  }

  // ---------------------------------------------------------------------------
  // Stateful boltwall commands
  // ---------------------------------------------------------------------------
  if (cmd === "GetBoltwallAccessibility") {
    return NextResponse.json({ isPublic: mockIsPublic });
  }

  if (cmd === "UpdateBoltwallAccessibility") {
    setMockIsPublic(Boolean(content));
    return NextResponse.json({ success: true });
  }

  if (cmd === "ListPaidEndpoint") {
    return NextResponse.json({ endpoints: mockEndpoints });
  }

  if (cmd === "UpdatePaidEndpoint") {
    const update = content as { id?: number; status?: boolean } | undefined;
    if (update?.id !== undefined) {
      setMockEndpoints(
        mockEndpoints.map((ep) =>
          ep.id === update.id ? { ...ep, status: Boolean(update.status) } : ep
        )
      );
    }
    return NextResponse.json({ success: true });
  }

  // ---------------------------------------------------------------------------
  // Static responses
  // ---------------------------------------------------------------------------
  if (!(cmd in MOCK_RESPONSES)) {
    return NextResponse.json({ error: `Unknown cmd: ${cmd}` }, { status: 400 });
  }

  return NextResponse.json(MOCK_RESPONSES[cmd]);
}
