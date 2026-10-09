import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { type ApiError } from "@/types";
import {
  releasePodById,
  getPodDetails,
  updatePodRepositories,
  releaseTaskPod,
  POD_PORTS,
  buildPodUrl,
} from "@/lib/pods";
import { resolvePodCaller } from "@/lib/auth/pod-access";
import { getPodUsageStatus, jobClaimant } from "@/lib/pods/queries";

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId: workspaceRef } = await params;

    // Validate required fields
    if (!workspaceRef) {
      return NextResponse.json({ error: "Missing required field: workspaceId" }, { status: 400 });
    }

    // Check for "latest", "podId", and "taskId" query parameters
    const { searchParams } = new URL(request.url);
    const shouldResetRepositories = searchParams.get("latest") === "true";
    const podId = searchParams.get("podId");
    const taskId = searchParams.get("taskId");
    // The strut job releasing its own pod (strut plans/job-artifact-events.md §2).
    const job = taskId ? null : searchParams.get("job");

    // podId is required - we must know which specific pod to drop
    if (!podId) {
      return NextResponse.json({ error: "Missing required field: podId" }, { status: 400 });
    }

    // Auth + workspace access (system API_TOKEN, org API key, or session member).
    // The segment is an id or a slug (a strut job releases by the slug it
    // claimed with); from here on `workspaceId` is the resolved id.
    const caller = await resolvePodCaller(request, { idOrSlug: workspaceRef });
    if (caller instanceof NextResponse) {
      return caller;
    }
    const workspaceId = caller.workspaceId;

    // Org keys are scoped to their org's workspaces: the pod must belong to
    // this workspace's swarm, otherwise a key could release any org's pod.
    if (caller.kind === "org") {
      const pod = await db.pod.findFirst({
        where: { podId, deletedAt: null, swarm: { workspaceId } },
        select: { id: true },
      });
      if (!pod) {
        return NextResponse.json({ error: "Pod not found in this workspace" }, { status: 404 });
      }
    }

    // If taskId is provided, use the shared releaseTaskPod() function
    if (taskId) {
      const result = await releaseTaskPod({
        taskId,
        podId,
        workspaceId,
        verifyOwnership: true,
        resetRepositories: shouldResetRepositories,
        clearTaskFields: true,
        newWorkflowStatus: "COMPLETED",
      });

      if (result.reassigned) {
        return NextResponse.json(
          { error: "Pod has been reassigned to another task", reassigned: true, taskCleared: result.taskCleared },
          { status: 409 },
        );
      }

      if (!result.success && result.error) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      return NextResponse.json(
        {
          success: true,
          message: "Pod dropped successfully",
          taskCleared: result.taskCleared,
        },
        { status: 200 },
      );
    }

    // No taskId provided - drop pod directly without task cleanup
    // This is for cases where we just want to release a pod without task association

    if (process.env.MOCK_BROWSER_URL) {
      return NextResponse.json({ success: true, message: "Pod dropped successfully" }, { status: 200 });
    }

    // Fetch workspace with swarm and repositories
    const workspace = await db.workspace.findFirst({
      where: { id: workspaceId },
      include: {
        swarm: true,
        repositories: true,
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Check if workspace has a swarm
    if (!workspace.swarm) {
      return NextResponse.json({ error: "No swarm found for this workspace" }, { status: 404 });
    }

    // A job releases only a pod it still holds — the task path's ownership
    // rule, for jobs: a pod hive recycled and handed to a task (or another
    // job) is not dropped from under it by a late release — strut's idle
    // sweep days later, or an agent acting on a stale pod id. A pod nobody
    // claimed (`usage_status_marked_by` null: claimed by a strut whose steps
    // did not send a job yet) is anybody's to release, as before. 404 when
    // hive has already let the pod go; the step treats both as released.
    if (job) {
      const usage = await getPodUsageStatus(podId);
      if (!usage) {
        return NextResponse.json({ error: "Pod not found" }, { status: 404 });
      }
      const claimant = usage.usageStatusMarkedBy;
      if (claimant !== null && claimant !== jobClaimant(job)) {
        console.log(`>>> Pod ${podId} is held by ${claimant}, not job ${job}; not dropping it`);
        return NextResponse.json({ error: "Pod has been reassigned", reassigned: true }, { status: 409 });
      }
    }

    console.log(">>> Dropping pod with ID:", podId);

    // If "latest" parameter is provided, reset the pod repositories before dropping
    if (shouldResetRepositories) {
      const podDetails = await getPodDetails(podId);

      if (!podDetails) {
        return NextResponse.json({ error: "Pod not found" }, { status: 404 });
      }

      const controlPort = parseInt(POD_PORTS.CONTROL, 10);
      const hasControlPort = podDetails.portMappings?.includes(controlPort) ?? false;

      if (!hasControlPort) {
        console.error(`Control port (${POD_PORTS.CONTROL}) not found in port mappings, skipping repository reset`);
      } else if (!podDetails.password) {
        console.error("Pod password not found, skipping repository reset");
      } else {
        try {
          const repositories = workspace.repositories.map((repo) => ({ url: repo.repositoryUrl }));

          if (repositories.length > 0) {
            const controlPortUrl = buildPodUrl(podDetails.podId, POD_PORTS.CONTROL);
            await updatePodRepositories(controlPortUrl, podDetails.password, repositories);
          } else {
            console.log(">>> No repositories to reset");
          }
        } catch (error) {
          console.error("Error resetting pod repositories:", error);
        }
      }
    }

    // Drop the pod using database query
    await releasePodById(podId);

    return NextResponse.json(
      {
        success: true,
        message: "Pod dropped successfully",
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error dropping pod:", error);

    // Handle ApiError specifically
    if (error && typeof error === "object" && "status" in error) {
      const apiError = error as ApiError;
      return NextResponse.json(
        {
          error: apiError.message,
          service: apiError.service,
          details: apiError.details,
        },
        { status: apiError.status },
      );
    }

    return NextResponse.json({ error: "Failed to drop pod" }, { status: 500 });
  }
}
