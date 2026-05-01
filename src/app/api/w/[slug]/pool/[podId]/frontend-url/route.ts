import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceBySlug } from "@/services/workspace";
import { db } from "@/lib/db";
import { POD_BASE_DOMAIN, buildPodUrl } from "@/lib/pods/queries";
import { POD_PORTS, PROCESS_NAMES } from "@/lib/pods/constants";
import { JlistResponseSchema, type JlistProcess } from "@/types/pod-repair";

export const runtime = "nodejs";

/**
 * Resolve the "Open Browser" frontend URL for a given pod.
 *
 * Strategy (in order):
 *   1. Hit the pod's `/jlist` (control port) and look for the `frontend` process.
 *      Use its declared port to build the URL.
 *   2. Fall back to port 3000 (POD_PORTS.FRONTEND_FALLBACK) if jlist is
 *      unreachable, returns no frontend process, or the process has no port.
 *
 * The IDE URL (no port) is intentionally NOT returned here — that's the bare
 * `vm.url` already on `VMData`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; podId: string }> },
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, podId } = await params;

    if (!slug || !podId) {
      return NextResponse.json(
        { error: "Workspace slug and podId are required" },
        { status: 400 },
      );
    }

    const workspace = await getWorkspaceBySlug(slug, userOrResponse.id);
    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    // Verify the pod belongs to this workspace's swarm
    const pod = await db.pod.findFirst({
      where: {
        podId,
        deletedAt: null,
        swarm: { workspaceId: workspace.id },
      },
      select: { podId: true, password: true },
    });

    if (!pod) {
      return NextResponse.json(
        { error: "Pod not found in this workspace" },
        { status: 404 },
      );
    }

    const fallbackUrl = buildPodUrl(pod.podId, POD_PORTS.FRONTEND_FALLBACK);

    // Best-effort jlist lookup. On any failure we return the fallback URL so
    // the user always gets *something* to click.
    const frontendUrl = await resolveFrontendUrl(pod.podId, pod.password).catch(
      (err) => {
        console.warn(
          `[frontend-url] jlist lookup failed for ${pod.podId}, using fallback:`,
          err,
        );
        return fallbackUrl;
      },
    );

    return NextResponse.json({ success: true, data: { frontendUrl } });
  } catch (error) {
    console.error("[frontend-url] unexpected error:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

async function resolveFrontendUrl(
  podId: string,
  password: string | null,
): Promise<string> {
  const fallbackUrl = buildPodUrl(podId, POD_PORTS.FRONTEND_FALLBACK);

  const jlist = await fetchJlist(podId, password);
  if (!jlist) return fallbackUrl;

  const frontendProcess = jlist.find(
    (proc) => proc.name === PROCESS_NAMES.FRONTEND,
  );
  if (!frontendProcess?.port) return fallbackUrl;

  return buildPodUrl(podId, frontendProcess.port);
}

async function fetchJlist(
  podId: string,
  password: string | null,
): Promise<JlistProcess[] | null> {
  const jlistUrl = `https://${podId}-${POD_PORTS.CONTROL}.${POD_BASE_DOMAIN}/jlist`;

  try {
    const response = await fetch(jlistUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(password ? { Authorization: `Bearer ${password}` } : {}),
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.warn(
        `[frontend-url] jlist ${response.status} for ${podId}`,
      );
      return null;
    }

    const data = await response.json();
    const parsed = JlistResponseSchema.safeParse(data);
    if (!parsed.success) {
      console.warn(
        `[frontend-url] invalid jlist payload for ${podId}: ${parsed.error.message}`,
      );
      return null;
    }
    return parsed.data as JlistProcess[];
  } catch (error) {
    console.warn(`[frontend-url] jlist fetch error for ${podId}:`, error);
    return null;
  }
}
