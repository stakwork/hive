import { db } from "@/lib/db";
import { FeatureStatus, TaskStatus, WorkflowStatus, NotificationTriggerType } from "@prisma/client";
import { updateFeature } from "./features";
import { createAndSendNotification } from "@/services/notifications";

/**
 * Calculates the appropriate Feature status based on child Task statuses
 * and updates the Feature record if the status has changed.
 * 
 * Status Priority Logic:
 * 1. FAILED/ERROR: If any task has WorkflowStatus.FAILED or WorkflowStatus.ERROR → return early, leave feature unchanged
 * 2. BLOCKED: If any task has WorkflowStatus.HALTED or TaskStatus.BLOCKED → IN_PROGRESS
 * 3. IN_PROGRESS: If any task has TaskStatus.IN_PROGRESS or WorkflowStatus.IN_PROGRESS → IN_PROGRESS
 * 4. COMPLETED: If all tasks are TaskStatus.DONE and WorkflowStatus.COMPLETED → COMPLETED
 * 5. Otherwise: No change (return early)
 * 
 * @param featureId - The ID of the feature to update
 * @returns Promise<void>
 */
export async function updateFeatureStatusFromTasks(featureId: string): Promise<void> {
  try {
    // Step 2: Query all non-deleted tasks for the feature
    const tasks = await db.task.findMany({
      where: {
        featureId,
        deleted: false,
      },
      select: {
        status: true,
        workflowStatus: true,
      },
    });

    // Step 3: If no tasks exist, return early (no auto-update)
    if (tasks.length === 0) {
      console.log(`[feature-status-sync] No tasks found for feature ${featureId}, skipping status update`);
      return;
    }

    // Step 4: Implement status priority logic
    let computedStatus: FeatureStatus | null = null;

    // Priority 1: If any task has FAILED or ERROR workflow status, leave the feature untouched
    const hasError = tasks.some(
      task => task.workflowStatus === WorkflowStatus.ERROR || task.workflowStatus === WorkflowStatus.FAILED
    );
    if (hasError) {
      console.log(`[feature-status-sync] Feature ${featureId} has FAILED/ERROR tasks, leaving feature status unchanged`);
      return;
    }

    // Priority 2: Check for BLOCKED (WorkflowStatus.HALTED or TaskStatus.BLOCKED)
    if (!computedStatus) {
      const isBlocked = tasks.some(
        task => task.workflowStatus === WorkflowStatus.HALTED || task.status === TaskStatus.BLOCKED
      );
      if (isBlocked) {
        // Note: FeatureStatus doesn't have BLOCKED state, keep in IN_PROGRESS
        computedStatus = FeatureStatus.IN_PROGRESS;
        console.log(`[feature-status-sync] Feature ${featureId} has BLOCKED/HALTED tasks, keeping IN_PROGRESS`);
      }
    }

    // Priority 3: Check for IN_PROGRESS (TaskStatus.IN_PROGRESS or WorkflowStatus.IN_PROGRESS)
    if (!computedStatus) {
      const isInProgress = tasks.some(
        task => task.status === TaskStatus.IN_PROGRESS || task.workflowStatus === WorkflowStatus.IN_PROGRESS
      );
      if (isInProgress) {
        computedStatus = FeatureStatus.IN_PROGRESS;
        console.log(`[feature-status-sync] Feature ${featureId} has IN_PROGRESS tasks`);
      }
    }

    // Priority 4: Check for COMPLETED (all tasks DONE and COMPLETED)
    if (!computedStatus) {
      const allCompleted = tasks.every(
        task => task.status === TaskStatus.DONE && 
               (task.workflowStatus === WorkflowStatus.COMPLETED || task.workflowStatus === null)
      );
      if (allCompleted) {
        computedStatus = FeatureStatus.COMPLETED;
        console.log(`[feature-status-sync] Feature ${featureId} has all tasks COMPLETED`);
      }
    }

    // Step 5: If no status computed, return early (no change needed)
    if (!computedStatus) {
      console.log(`[feature-status-sync] No status change needed for feature ${featureId}`);
      return;
    }

    // Step 5: Get current feature with workspace
    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: {
        id: true,
        status: true,
        assigneeId: true,
        createdById: true,
        title: true,
        workspace: {
          select: {
            id: true,
            ownerId: true,
            slug: true,
          },
        },
      },
    });

    if (!feature) {
      console.error(`[feature-status-sync] Feature ${featureId} not found`);
      return;
    }

    // Step 6: Only update if computed status differs from current status
    if (feature.status === computedStatus) {
      console.log(`[feature-status-sync] Feature ${featureId} already has status ${computedStatus}, no update needed`);
      return;
    }

    // Step 7 & 8: Use workspace ownerId as the updatedById for system automation
    console.log(`[feature-status-sync] Updating feature ${featureId} status from ${feature.status} to ${computedStatus}`);
    await updateFeature(featureId, feature.workspace.ownerId, {
      status: computedStatus,
    });

    // Fire FEATURE_COMPLETED notification (fire-and-forget)
    if (computedStatus === FeatureStatus.COMPLETED) {
      const targetUserId = feature.assigneeId ?? feature.createdById;
      const featureUrl = `${process.env.NEXTAUTH_URL}/w/${feature.workspace.slug}/plan/${featureId}`;
      void (async () => {
        try {
          const targetUser = await db.user.findUnique({
            where: { id: targetUserId },
            select: { sphinxAlias: true, name: true },
          });
          const alias = targetUser?.sphinxAlias ?? targetUser?.name ?? "User";
          await createAndSendNotification({
            targetUserId,
            featureId,
            workspaceId: feature.workspace.id,
            notificationType: NotificationTriggerType.FEATURE_COMPLETED,
            message: `@${alias} — Feature '${feature.title}' has been marked Complete. ${featureUrl}`,
          });
        } catch (notifError) {
          console.error(`[feature-status-sync] Error firing FEATURE_COMPLETED notification:`, notifError);
        }
      })();
    }

    console.log(`[feature-status-sync] Successfully updated feature ${featureId} to status ${computedStatus}`);
  } catch (error) {
    console.error(`[feature-status-sync] Error updating feature ${featureId} status:`, error);
    throw error;
  }
}
