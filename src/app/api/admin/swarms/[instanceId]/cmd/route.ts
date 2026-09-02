import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { fetchSwarmCredentials } from "@/services/swarm/api/swarm";
import {
  getSwarmCmdJwt,
  swarmCmdRequest,
  SwarmCmd,
  SwarmAuthError,
  SwarmCmdConfigError,
} from "@/services/swarm/cmd";
import { resolveDbSwarmCredentials } from "@/services/swarm/cmd-credentials";
import { resolveSwarmHost, isAllowedSwarmHost, isAbortErrorLike } from "@/services/swarm/host-storage-read";
import { redis } from "@/lib/redis";

export const runtime = "nodejs";

const LOG_PREFIX = "[AdminSwarmCmd]";

/** Timeout for the login round-trip only, so a DB-credential login attempt
 * that hangs is bounded and produces a real `AbortError` rather than stalling
 * the request indefinitely. */
const CMD_LOGIN_TIMEOUT_MS = 10_000;

/** Generic message returned to the client on any login failure (DB or
 * super-admin) — never `error.message`, which for `getSwarmCmdJwt` failures
 * that predate `SwarmAuthError` (or the generic missing-token error) may
 * embed the swarm's raw response text. */
const AUTH_FAILURE_MESSAGE = "Failed to authenticate with swarm";

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

  let resolvedSwarmUrl = swarmUrl && typeof swarmUrl === "string" ? swarmUrl : undefined;

  if (!resolvedSwarmUrl) {
    const cached = await redis.get("admin:swarms:list");
    if (cached) {
      const instances = JSON.parse(cached) as Array<{
        instanceId: string;
        tags?: Array<{ key: string; value: string }>;
      }>;
      const instance = instances.find((i) => i.instanceId === instanceId);
      const userAssignedName = instance?.tags?.find((t) => t.key === "UserAssignedName")?.value;
      if (userAssignedName) {
        resolvedSwarmUrl = `https://${userAssignedName}.sphinx.chat`;
      }
    }
  }

  if (!resolvedSwarmUrl) {
    return NextResponse.json(
      {
        error:
          "Could not resolve swarmUrl for this instance — cache may be cold or UserAssignedName tag is missing",
      },
      { status: 400 }
    );
  }

  // 1. DB-first credential resolution. The super-admin API is only consulted
  //    below when this path yields no usable credential or a 401.
  const dbCredentials = await resolveDbSwarmCredentials(instanceId);

  if (dbCredentials) {
    const dbHost = resolveSwarmHost(dbCredentials.swarmUrl);
    if (dbHost && isAllowedSwarmHost(dbHost)) {
      try {
        const jwt = await getSwarmCmdJwt(
          dbCredentials.swarmUrl,
          dbCredentials.password,
          dbCredentials.username,
          CMD_LOGIN_TIMEOUT_MS
        );
        console.log(`${LOG_PREFIX} DB password used successfully instance=${instanceId}`);
        const result = await swarmCmdRequest({ swarmUrl: dbCredentials.swarmUrl, jwt, cmd });
        return NextResponse.json(result);
      } catch (error) {
        if (error instanceof SwarmAuthError && error.status === 401) {
          console.warn(`${LOG_PREFIX} db-auth-401 instance=${instanceId}`);
          // Fall through to the super-admin fallback below.
        } else if (isAbortErrorLike(error)) {
          console.error(`${LOG_PREFIX} db login timeout instance=${instanceId}`);
          return NextResponse.json({ error: AUTH_FAILURE_MESSAGE }, { status: 502 });
        } else if (error instanceof SwarmAuthError) {
          console.error(`${LOG_PREFIX} db login failed status=${error.status} instance=${instanceId}`);
          return NextResponse.json({ error: AUTH_FAILURE_MESSAGE }, { status: 502 });
        } else if (error instanceof SwarmCmdConfigError) {
          console.error(`${LOG_PREFIX} db login config invalid instance=${instanceId}`);
          return NextResponse.json({ error: AUTH_FAILURE_MESSAGE }, { status: 502 });
        } else {
          // Generic missing-token error or any other unexpected failure.
          console.error(`${LOG_PREFIX} db login failed instance=${instanceId}`);
          return NextResponse.json({ error: AUTH_FAILURE_MESSAGE }, { status: 502 });
        }
      }
    } else {
      console.warn(`${LOG_PREFIX} db-host-not-allowed instance=${instanceId}`);
      // Fall through to the super-admin fallback below.
    }
  }

  // 2. Super-admin fallback (read-only, unmodified). SSRF hardening applies
  //    here too: `resolvedSwarmUrl` can come straight from caller input
  //    (`body.swarmUrl`), so it must be host-allowlisted BEFORE the
  //    super-admin-fetched password is ever sent to it.
  const fallbackHost = resolveSwarmHost(resolvedSwarmUrl);
  if (!fallbackHost || !isAllowedSwarmHost(fallbackHost)) {
    return NextResponse.json({ error: "swarmUrl host is not allowed" }, { status: 400 });
  }

  let credentials: { username: string; password: string };
  try {
    credentials = await fetchSwarmCredentials(instanceId);
  } catch (error) {
    console.error(`Failed to fetch swarm credentials for ${instanceId}:`, error);
    return NextResponse.json({ error: AUTH_FAILURE_MESSAGE }, { status: 502 });
  }

  let jwt: string;
  try {
    jwt = await getSwarmCmdJwt(resolvedSwarmUrl, credentials.password, credentials.username);
  } catch (error) {
    console.error(`Failed to get JWT for swarm ${instanceId}:`, error);
    return NextResponse.json({ error: AUTH_FAILURE_MESSAGE }, { status: 502 });
  }

  try {
    const result = await swarmCmdRequest({ swarmUrl: resolvedSwarmUrl, jwt, cmd });
    return NextResponse.json(result);
  } catch (error) {
    console.error(`Swarm cmd request failed for ${instanceId}:`, error);
    return NextResponse.json(
      { error: `Swarm command failed: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
