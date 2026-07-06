import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildPodUrl, POD_PORTS } from "@/lib/pods";
import { requireAuthOrApiToken, validateApiToken } from "@/lib/auth/api-token";
import { checkRateLimit } from "@/lib/rate-limit";

const INJECT_STAKTRAK_PROMPT =
  'Please add the Staktrak JS script to the frontend of this project. In most cases: `<script src="https://hive.sphinx.chat/js/staktrak.js" type="text/javascript"></script>`. For Next.js, use a `<Script />` tag in the root layout. Read `package.json` first to determine the correct approach for this repo. If `staktrak.js` is already present, do nothing.';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;

  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Missing required field: workspaceId" }, { status: 400 });
  }

  // Step 1: Auth — same dual-auth pattern as claim-pod
  const isApiTokenAuth = validateApiToken(request);

  let userId: string | undefined;

  if (!isApiTokenAuth) {
    const userOrResponse = await requireAuthOrApiToken(request, workspaceId);
    if (userOrResponse instanceof NextResponse) {
      return userOrResponse;
    }
    userId = userOrResponse.id;
  }

  // Parse body
  let podId: string;
  try {
    const body = await request.json();
    podId = body?.podId;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  if (!podId) {
    return NextResponse.json({ success: false, error: "Missing required field: podId" }, { status: 400 });
  }

  // Step 2: Fetch workspace with swarm (and members for session auth)
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, deleted: false },
    include: {
      swarm: true,
      members: userId
        ? { where: { userId }, select: { role: true } }
        : { select: { role: true }, take: 0 },
    },
  });

  if (!workspace) {
    return NextResponse.json({ success: false, error: "Workspace not found" }, { status: 404 });
  }

  // Enforce ownership/membership check for session-based auth
  if (!isApiTokenAuth) {
    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
    }
  }

  if (!workspace.swarm) {
    return NextResponse.json({ success: false, error: "No swarm found for this workspace" }, { status: 404 });
  }

  // Step 3: IDOR guard — query pod directly to verify it belongs to this workspace's swarm
  const pod = await db.pod.findFirst({
    where: { podId, deletedAt: null },
    select: { swarmId: true, password: true, portMappings: true },
  });

  if (!pod) {
    return NextResponse.json({ success: false, error: "Pod not found" }, { status: 404 });
  }

  if (pod.swarmId !== workspace.swarm.id) {
    return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
  }

  // Step 4: Rate limit — 1 dispatch per workspace per 2 minutes
  const rl = await checkRateLimit(`rl:inject-staktrak:${workspaceId}`, 1, 120);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Rate limit exceeded. Please try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter ?? 120) },
      },
    );
  }

  // Step 5: Atomic dispatch gate — set staktrakInjected true only if currently false
  const gate = await db.swarm.updateMany({
    where: { id: workspace.swarm.id, staktrakInjected: false },
    data: { staktrakInjected: true },
  });

  if (gate.count === 0) {
    // Already injected — nothing to do
    return NextResponse.json({ success: true, alreadyInjected: true }, { status: 200 });
  }

  // Step 6: POST injection prompt to the pod's control agent
  // pod.password is stored in plaintext — use directly as Bearer, no decryption needed
  const controlUrl = buildPodUrl(podId, POD_PORTS.CONTROL);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const agentResponse = await fetch(`${controlUrl}/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pod.password}`,
      },
      body: JSON.stringify({ prompt: INJECT_STAKTRAK_PROMPT }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!agentResponse.ok) {
      console.error(
        `[inject-staktrak] Pod agent responded with ${agentResponse.status} for workspace ${workspaceId}`,
      );
      return NextResponse.json(
        { success: false, error: `Pod agent responded with status ${agentResponse.status}` },
        { status: 502 },
      );
    }
  } catch (error) {
    console.error(`[inject-staktrak] Failed to reach pod agent for workspace ${workspaceId}:`, error);
    // NOTE: We do NOT roll back staktrakInjected here — retry-storms are worse than a rare stuck flag.
    // The flag can be manually reset via DB if injection needs to be retried.
    return NextResponse.json(
      { success: false, error: "Failed to reach pod agent endpoint" },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
