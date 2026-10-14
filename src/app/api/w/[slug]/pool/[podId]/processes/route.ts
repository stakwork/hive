import { NextRequest, NextResponse } from "next/server";
import { resolvePodCaller } from "@/lib/auth/pod-access";
import { db } from "@/lib/db";
import { staklinkFetch } from "@/lib/pods/staklink";
import { JlistResponseSchema } from "@/types/pod-repair";

export const runtime = "nodejs";

/** Read-only: the pod's pm2 process list, proxied from staklink `/jlist`. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; podId: string }> },
) {
  try {
    const { slug, podId } = await params;
    if (!slug || !podId) {
      return NextResponse.json({ error: "Workspace slug and podId are required" }, { status: 400 });
    }

    const caller = await resolvePodCaller(request, { slug });
    if (caller instanceof NextResponse) {
      return caller.status === 403
        ? NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 })
        : caller;
    }

    const pod = await db.pod.findFirst({
      where: { podId, deletedAt: null, swarm: { workspaceId: caller.workspaceId } },
      select: { podId: true, password: true, status: true },
    });
    if (!pod) {
      return NextResponse.json({ error: "Pod not found in this workspace" }, { status: 404 });
    }
    if (pod.status !== "RUNNING") {
      return NextResponse.json({ error: "pod_not_running", status: pod.status }, { status: 409 });
    }

    try {
      const response = await staklinkFetch(pod, "/jlist", { timeoutMs: 5000 });
      if (!response.ok) {
        return NextResponse.json({ error: "pod_unreachable", status: response.status }, { status: 502 });
      }
      const parsed = JlistResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        return NextResponse.json({ error: "pod_unreachable" }, { status: 502 });
      }
      return NextResponse.json({ success: true, data: { processes: parsed.data } });
    } catch {
      return NextResponse.json({ error: "pod_unreachable" }, { status: 502 });
    }
  } catch (error) {
    console.error("[pool/processes] unexpected error:", error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
