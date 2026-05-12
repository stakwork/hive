import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";
import { getPoolStatusFromPods } from "@/lib/pods/status-queries";
import { checkDependencies } from "@/services/task-coordinator-cron";

export type TaskAction = "DISPATCH" | "SKIP_PENDING" | "SKIP_BLOCKED";
export type DependencyResult = "SATISFIED" | "PENDING" | "PERMANENTLY_BLOCKED";
export type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface TaskSnapshot {
  id: string;
  title: string;
  priority: Priority;
  dependsOnTaskIds: string[];
  dependencyResult: DependencyResult;
  featureTitle: string | null;
  phase: string | null;
  action: TaskAction;
}

export interface WorkspaceSnapshot {
  id: string;
  slug: string;
  name: string;
  swarmEnabled: boolean;
  ticketSweepEnabled: boolean;
  recommendationSweepEnabled: boolean;
  totalPods: number;
  runningPods: number;
  usedPods: number;
  unusedPods: number;
  failedPods: number;
  pendingPods: number;
  queuedCount: number;
  slotsAvailable: number;
  candidateTasks: TaskSnapshot[];
  pendingRecommendations: number;
  processingNote: string | null;
}

export interface CoordinatorSnapshot {
  timestamp: string;
  totalWorkspacesWithSweep: number;
  totalSlotsAvailable: number;
  totalQueued: number;
  totalStaleTasks: number;
  totalOrphanedPods: number;
  workspaces: WorkspaceSnapshot[];
}

export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    // Configurable stale task threshold (default: 24 hours)
    const staleHours = parseInt(process.env.STALE_TASK_HOURS || "24", 10);
    const staleThreshold = new Date(Date.now() - staleHours * 60 * 60 * 1000);

    // Fetch enabled workspaces + stale task count in parallel
    // Orphaned pod refs require a two-step query (no Prisma relation from Task → Pod)
    const [enabledWorkspaces, staleTasks, softDeletedPods] = await Promise.all([
      db.workspace.findMany({
        where: {
          deleted: false,
          janitorConfig: {
            OR: [{ recommendationSweepEnabled: true }, { ticketSweepEnabled: true }],
          },
        },
        include: {
          janitorConfig: true,
          swarm: true,
        },
      }),
      // Stale tasks: tasks with a pod or IN_PROGRESS (not halted) older than threshold
      db.task.count({
        where: {
          deleted: false,
          updatedAt: { lt: staleThreshold },
          OR: [
            { podId: { not: null } },
            {
              status: "IN_PROGRESS",
              workflowStatus: { not: WorkflowStatus.HALTED },
            },
          ],
        },
      }),
      // Get soft-deleted pod IDs so we can count tasks referencing them
      // Task.podId stores the Pod.podId string (no Prisma relation exists)
      db.pod.findMany({
        where: { deletedAt: { not: null } },
        select: { podId: true },
      }),
    ]);

    // Count orphaned pod refs: tasks whose podId points at a soft-deleted pod
    const softDeletedPodIds = softDeletedPods.map((p) => p.podId);
    const orphanedPodRefs =
      softDeletedPodIds.length > 0
        ? await db.task.count({
            where: {
              podId: { in: softDeletedPodIds },
              deleted: false,
            },
          })
        : 0;

    // Process each workspace in parallel
    const workspaceSnapshots = await Promise.all(
      enabledWorkspaces.map(async (ws): Promise<WorkspaceSnapshot> => {
        const ticketSweepEnabled = ws.janitorConfig?.ticketSweepEnabled ?? false;
        const recommendationSweepEnabled =
          ws.janitorConfig?.recommendationSweepEnabled ?? false;

        // No swarm configured — skip pool/task queries
        if (!ws.swarm?.id) {
          return {
            id: ws.id,
            slug: ws.slug,
            name: ws.name,
            swarmEnabled: false,
            ticketSweepEnabled,
            recommendationSweepEnabled,
            totalPods: 0,
            runningPods: 0,
            usedPods: 0,
            unusedPods: 0,
            failedPods: 0,
            pendingPods: 0,
            queuedCount: 0,
            slotsAvailable: 0,
            candidateTasks: [],
            pendingRecommendations: 0,
            processingNote: "No pool configured, skipping",
          };
        }

        const poolStatus = await getPoolStatusFromPods(ws.swarm.id, ws.id);
        const totalPods =
          poolStatus.runningVms + poolStatus.pendingVms + poolStatus.failedVms;
        const slotsAvailable =
          poolStatus.unusedVms <= 1 ? 0 : poolStatus.unusedVms - 1;

        if (slotsAvailable === 0) {
          const pendingRecommendations = await db.janitorRecommendation.count({
            where: {
              status: "PENDING",
              janitorRun: { janitorConfig: { workspaceId: ws.id } },
            },
          });

          return {
            id: ws.id,
            slug: ws.slug,
            name: ws.name,
            swarmEnabled: true,
            ticketSweepEnabled,
            recommendationSweepEnabled,
            totalPods,
            runningPods: poolStatus.runningVms,
            usedPods: poolStatus.usedVms,
            unusedPods: poolStatus.unusedVms,
            failedPods: poolStatus.failedVms,
            pendingPods: poolStatus.pendingVms,
            queuedCount: poolStatus.queuedCount,
            slotsAvailable: 0,
            candidateTasks: [],
            pendingRecommendations,
            processingNote: "Insufficient available pods (need 2+), skipping",
          };
        }

        // Fetch candidates + pending recommendations in parallel
        const candidateLimit = Math.max(slotsAvailable * 3, 20);
        const [candidateTasks, pendingRecommendations] = await Promise.all([
          db.task.findMany({
            where: {
              AND: [
                { workspaceId: ws.id },
                { status: "TODO" },
                { systemAssigneeType: "TASK_COORDINATOR" },
                { deleted: false },
                {
                  OR: [
                    { workflowStatus: WorkflowStatus.PENDING },
                    { workflowStatus: null },
                  ],
                },
                { stakworkProjectId: null },
                {
                  OR: [
                    { featureId: null },
                    { feature: { status: { not: "CANCELLED" } } },
                  ],
                },
              ],
            },
            select: {
              id: true,
              title: true,
              priority: true,
              dependsOnTaskIds: true,
              feature: { select: { title: true } },
              phase: { select: { name: true } },
            },
            orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
            take: candidateLimit,
          }),
          db.janitorRecommendation.count({
            where: {
              status: "PENDING",
              janitorRun: { janitorConfig: { workspaceId: ws.id } },
            },
          }),
        ]);

        // Evaluate dependencies for each candidate (read-only)
        const taskSnapshots: TaskSnapshot[] = await Promise.all(
          candidateTasks.map(async (task) => {
            const depResult = await checkDependencies(task.dependsOnTaskIds);
            const action: TaskAction =
              depResult === "SATISFIED"
                ? "DISPATCH"
                : depResult === "PENDING"
                  ? "SKIP_PENDING"
                  : "SKIP_BLOCKED";

            return {
              id: task.id,
              title: task.title,
              priority: (task.priority ?? "MEDIUM") as Priority,
              dependsOnTaskIds: task.dependsOnTaskIds,
              dependencyResult: depResult,
              featureTitle: task.feature?.title ?? null,
              phase: task.phase?.name ?? null,
              action,
            };
          })
        );

        return {
          id: ws.id,
          slug: ws.slug,
          name: ws.name,
          swarmEnabled: true,
          ticketSweepEnabled,
          recommendationSweepEnabled,
          totalPods,
          runningPods: poolStatus.runningVms,
          usedPods: poolStatus.usedVms,
          unusedPods: poolStatus.unusedVms,
          failedPods: poolStatus.failedVms,
          pendingPods: poolStatus.pendingVms,
          queuedCount: poolStatus.queuedCount,
          slotsAvailable,
          candidateTasks: taskSnapshots,
          pendingRecommendations,
          processingNote: null,
        };
      })
    );

    const snapshot: CoordinatorSnapshot = {
      timestamp: new Date().toISOString(),
      totalWorkspacesWithSweep: enabledWorkspaces.length,
      totalSlotsAvailable: workspaceSnapshots.reduce(
        (sum, ws) => sum + ws.slotsAvailable,
        0
      ),
      totalQueued: workspaceSnapshots.reduce(
        (sum, ws) => sum + ws.queuedCount,
        0
      ),
      totalStaleTasks: staleTasks,
      totalOrphanedPods: orphanedPodRefs,
      workspaces: workspaceSnapshots,
    };

    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[TaskCoordinatorSnapshot] Error:", message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
