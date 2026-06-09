/**
 * Reusable helper that creates a workflow_editor task from a workflow version.
 * Extracted from the workflows list page handleSubmit so the inspector and
 * other callers can reuse the exact same three-step sequence.
 *
 * Steps:
 *   1. POST /api/tasks  — creates the task record
 *   2. POST /api/tasks/:id/messages/save — saves the WORKFLOW artifact
 *   3. POST /api/tasks/:id/workflow-task — dual-writes the WorkflowTask row
 *
 * Throws on any non-ok response so callers can handle errors cleanly.
 */

import { ArtifactType } from "@prisma/client";
import { WorkflowVersion } from "@/hooks/useWorkflowVersions";

export async function createWorkflowEditorTask(
  slug: string,
  version: WorkflowVersion,
  workflowName: string,
): Promise<string> {
  const workflowId = version.workflow_id;
  const workflowVersionId = String(version.workflow_version_id);
  const workflowRefId = version.ref_id;
  const workflowJson = version.workflow_json;

  const taskTitle = `${workflowName} v${workflowVersionId.substring(0, 8)}`;
  const taskDescription = `Editing workflow ${workflowId} version ${workflowVersionId.substring(0, 8)}`;

  // 1. Create the task
  const taskRes = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: taskTitle,
      description: taskDescription,
      status: "active",
      workspaceSlug: slug,
      mode: "workflow_editor",
    }),
  });

  if (!taskRes.ok) {
    throw new Error(`Failed to create task: ${taskRes.statusText}`);
  }

  const taskData = await taskRes.json();
  const taskId: string = taskData.data.id;

  // 2. Save the WORKFLOW artifact
  const saveRes = await fetch(`/api/tasks/${taskId}/messages/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Loaded: ${taskTitle}\nSelect a step on the right as a starting point.`,
      role: "ASSISTANT",
      artifacts: [
        {
          type: ArtifactType.WORKFLOW,
          content: {
            workflowJson,
            workflowId,
            workflowName,
            workflowRefId,
            workflowVersionId,
          },
        },
      ],
    }),
  });

  if (!saveRes.ok) {
    throw new Error(`Failed to save workflow artifact: ${saveRes.statusText}`);
  }

  // 3. Dual-write the WorkflowTask row
  const wtRes = await fetch(`/api/tasks/${taskId}/workflow-task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workflowId,
      workflowName,
      workflowRefId,
      workflowVersionId,
    }),
  });

  if (!wtRes.ok) {
    throw new Error(`Failed to create workflow-task record: ${wtRes.statusText}`);
  }

  return taskId;
}
