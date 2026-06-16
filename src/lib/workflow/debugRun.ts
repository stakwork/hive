import { ArtifactType } from "@/lib/chat";

export async function startDebugRun({
  slug,
  workflowId,
  runId,
}: {
  slug: string;
  workflowId: number;
  runId: number;
}): Promise<string> {
  // 1. Fetch latest version for the workflow
  const versionsRes = await fetch(`/api/workspaces/${slug}/workflows/${workflowId}/versions`);
  const versionsData = await versionsRes.json();
  const latestVersion = versionsData.data?.versions?.[0]; // API returns newest-first
  if (!latestVersion) throw new Error("No versions found for workflow");

  const workflowName = latestVersion.workflow_name || `Workflow ${workflowId}`;
  const workflowRefId = latestVersion.ref_id;
  const workflowJson = latestVersion.workflow_json;
  const workflowVersionId = String(latestVersion.workflow_version_id);
  const taskTitle = `Debug run ${runId}`;

  // 2. Create workflow_editor task
  const taskRes = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: taskTitle,
      description: taskTitle,
      status: "active",
      workspaceSlug: slug,
      mode: "workflow_editor",
    }),
  });
  if (!taskRes.ok) throw new Error("Failed to create task");
  const {
    data: { id: newTaskId },
  } = await taskRes.json();

  // 3. Save ASSISTANT workflow artifact
  await fetch(`/api/tasks/${newTaskId}/messages/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Loaded: ${workflowName}\nSelect a step on the right as a starting point.`,
      role: "ASSISTANT",
      artifacts: [
        {
          type: ArtifactType.WORKFLOW,
          content: { workflowJson, workflowId, workflowName, workflowRefId, workflowVersionId },
        },
      ],
    }),
  });

  // 3b. Dual-write WorkflowTask row
  await fetch(`/api/tasks/${newTaskId}/workflow-task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflowId, workflowName, workflowRefId, workflowVersionId }),
  });

  // 4. Auto-send "Debug this run [runId]" — triggers the AI workflow
  await fetch("/api/workflow-editor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskId: newTaskId,
      message: `Debug this run ${runId}`,
      workflowId,
      workflowName,
      workflowRefId,
      workflowVersionId,
    }),
  });

  return newTaskId;
}
