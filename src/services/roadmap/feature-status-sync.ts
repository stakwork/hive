import { db } from "@/lib/db";
import { FeatureStatus, TaskStatus, WorkflowStatus } from "@prisma/client";
import { updateFeature } from "./features";

/**
 * Calculates the appropriate Feature status based on child Task statuses
 * and updates the Feature record if the status has changed.
 * 
 * Status Priority Logic:
 * 1. ERROR: If any task has WorkflowStatus.ERROR or WorkflowStatus.FAILED
 * 2. BLOCKED: If any task has WorkflowStatus.HALTED or TaskStatus.BLOCKED
 * 3. IN_PROGRESS: If any task has TaskStatus.IN_PROGRESS or WorkflowStatus.IN_PROGRESS
 * 4. COMPLETED: If all tasks are TaskStatus.DONE and WorkflowStatus.COMPLETED
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

    // Priority 1: Check for ERROR (WorkflowStatus.ERROR or WorkflowStatus.FAILED)
    const hasError = tasks.some(
      task => task.workflowStatus === WorkflowStatus.ERROR || task.workflowStatus === WorkflowStatus.FAILED
    );
    if (hasError) {
      // Note: FeatureStatus doesn't have ERROR state, map to CANCELLED as error state
      computedStatus = FeatureStatus.CANCELLED;
      console.log(`[feature-status-sync] Feature ${featureId} has ERROR/FAILED tasks, mapping to CANCELLED`);
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
        workspace: {
          select: {
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

    // Step 9: Optional - Broadcast Pusher event
    // TODO: Implement Pusher event broadcast if needed
    // const pusher = getPusherInstance();
    // await pusher.trigger(`workspace-${feature.workspace.slug}`, 'FEATURE_STATUS_UPDATE', {
    //   featureId,
    //   newStatus: computedStatus,
    //   timestamp: new Date().toISOString(),
    // });

    console.log(`[feature-status-sync] Successfully updated feature ${featureId} to status ${computedStatus}`);
  } catch (error) {
    console.error(`[feature-status-sync] Error updating feature ${featureId} status:`, error);
    throw error;
  }
}
