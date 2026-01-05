import { toast } from "sonner";

/**
 * Archives a task and redirects to the task list page.
 * Used when pod claim fails or task needs to be archived.
 */
export async function archiveTaskAndRedirect(
  taskId: string,
  slug: string,
  errorTitle: string,
  errorDescription: string
) {
  try {
    // Archive the task
    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        archived: true,
      }),
    });

    toast.error(errorTitle, { description: errorDescription });

    // Redirect back to task list
    window.location.href = `/w/${slug}/tasks`;
  } catch (archiveError) {
    console.error("Error archiving task:", archiveError);
    toast.error("Error", {
      description: "Failed to claim pod and couldn't archive task. Please contact support.",
    });
  }
}
