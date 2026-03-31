import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { fetchSwarmCredentials } from "@/services/swarm/api/swarm";
import { getSwarmCmdJwt, swarmCmdRequest, SwarmCmd } from "@/services/swarm/cmd";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  const { instanceId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { cmd, swarmUrl } = body as { cmd?: SwarmCmd; swarmUrl?: string };

  if (!cmd || typeof cmd !== "object" || !("type" in cmd)) {
    return NextResponse.json({ error: "Missing or invalid 'cmd' field" }, { status: 400 });
  }

  if (!swarmUrl || typeof swarmUrl !== "string") {
    return NextResponse.json({ error: "Missing 'swarmUrl' field" }, { status: 400 });
  }

  let credentials: { username: string; password: string };
  try {
    credentials = await fetchSwarmCredentials(instanceId);
  } catch (error) {
    console.error(`Failed to fetch swarm credentials for ${instanceId}:`, error);
    return NextResponse.json(
      { error: `Failed to fetch swarm credentials: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 502 }
    );
  }

  let jwt: string;
  try {
    jwt = await getSwarmCmdJwt(swarmUrl, credentials.password, credentials.username);
  } catch (error) {
    console.error(`Failed to get JWT for swarm ${instanceId}:`, error);
    return NextResponse.json(
      { error: `Failed to authenticate with swarm: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 502 }
    );
  }

  try {
    const result = await swarmCmdRequest({ swarmUrl, jwt, cmd });
    return NextResponse.json(result);
  } catch (error) {
    console.error(`Swarm cmd request failed for ${instanceId}:`, error);
    return NextResponse.json(
      { error: `Swarm command failed: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
