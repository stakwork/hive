import { NextRequest, NextResponse } from "next/server";
import { resolvePodCaller } from "@/lib/auth/pod-access";
import { db } from "@/lib/db";
import { resolvePodClaimants } from "@/lib/pods/capacity-queries";
import { POD_BASE_DOMAIN, jobOfClaimant } from "@/lib/pods/queries";
import { podGeneration } from "@/lib/pods/rollout";
import { fetchJlist } from "@/lib/pods/staklink";

export const runtime = "nodejs";

const LIVE_CONCURRENCY = 5;
const LIVE_TIMEOUT_MS = 5000;

/** Read-only pod list for diagnosis. Never returns passwords or port mappings. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    if (!slug) {
      return NextResponse.json({ error: "Workspace slug is required" }, { status: 400 });
    }

    const caller = await resolvePodCaller(request, { slug });
    if (caller instanceof NextResponse) {
      return caller.status === 403
        ? NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 })
        : caller;
    }

    const swarm = await db.swarm.findFirst({
      where: { workspaceId: caller.workspaceId },
      select: { id: true, poolPushedAt: true },
    });
    if (!swarm) {
      return NextResponse.json({ error: "Pool not configured" }, { status: 404 });
    }

    const live = request.nextUrl.searchParams.get("live") === "1";

    const pods = await db.pod.findMany({
      where: {
        swarmId: swarm.id,
        deletedAt: null,
        podId: { not: { startsWith: "ws-pool-" } },
      },
      select: {
        podId: true,
        status: true,
        usageStatus: true,
        usageStatusMarkedBy: true,
        usageStatusMarkedAt: true,
        createdAt: true,
        flaggedForRecreation: true,
        flaggedReason: true,
        flaggedAt: true,
        lastHealthCheck: true,
        ...(live ? { password: true } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    const { taskMap, jobMap } = await resolvePodClaimants(pods);

    const result = pods.map((pod) => {
      const claimant = pod.usageStatus === "USED" ? pod.usageStatusMarkedBy : null;
      let usedBy: { kind: "task" | "job"; id: string; title: string } | null = null;
      if (claimant) {
        const jobId = jobOfClaimant(claimant);
        if (jobId) {
          usedBy = { kind: "job", id: jobId, title: jobMap.get(jobId)?.title ?? "Job" };
        } else {
          const task = taskMap.get(claimant);
          if (task) usedBy = { kind: "task", id: task.id, title: task.title };
        }
      }

      const generation = podGeneration(pod.createdAt, swarm.poolPushedAt);

      return {
        podId: pod.podId,
        url: `https://${pod.podId}.${POD_BASE_DOMAIN}`,
        status: pod.status,
        usageStatus: pod.usageStatus,
        usedBy,
        markedAt: pod.usageStatusMarkedAt,
        createdAt: pod.createdAt,
        flaggedForRecreation: pod.flaggedForRecreation,
        flaggedReason: pod.flaggedReason,
        flaggedAt: pod.flaggedAt,
        lastHealthCheck: pod.lastHealthCheck,
        generation,
        // In use, and something will recreate it on release: it is flagged, or
        // a push happened after it was created. With no push recorded every
        // pod is "old" and nothing is pending.
        willUpdateWhenReleased:
          pod.usageStatus === "USED" &&
          (pod.flaggedForRecreation || (generation === "old" && swarm.poolPushedAt !== null)),
      };
    });

    if (live) {
      const jlists: Array<Awaited<ReturnType<typeof fetchJlist>>> = new Array(pods.length).fill(null);
      let next = 0;
      const worker = async () => {
        while (next < pods.length) {
          const i = next++;
          const pod = pods[i] as (typeof pods)[number] & { password?: string | null };
          // A pod that is not RUNNING has no staklink to answer; skip the timeout
          jlists[i] =
            pod.status === "RUNNING"
              ? await fetchJlist(pod.podId, pod.password ?? null, LIVE_TIMEOUT_MS).catch(() => null)
              : null;
        }
      };
      await Promise.all(Array.from({ length: Math.min(LIVE_CONCURRENCY, pods.length) }, worker));
      return NextResponse.json({
        success: true,
        data: { pods: result.map((p, i) => ({ ...p, jlist: jlists[i] })) },
      });
    }

    return NextResponse.json({ success: true, data: { pods: result } });
  } catch (error) {
    console.error("[pool/pods] unexpected error:", error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
