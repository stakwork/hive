import { EmptyState, TaskCard } from "@/components/tasks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceTasks } from "@/hooks/useWorkspaceTasks";

export function RecentTasksCard() {
  const { slug, id: workspaceId, workspace } = useWorkspace();
  const { tasks } = useWorkspaceTasks(workspaceId, slug, true);

  // Get the 3 most recent tasks
  const recentTasks = tasks.slice(0, 3);

  // Don't render if workspace doesn't have repositories connected
  if (!workspace || !workspace.repositories?.length) {
    return null;
  }

  // Show empty state if no tasks
  if (recentTasks.length === 0) {
    return <EmptyState workspaceSlug={slug} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Tasks</CardTitle>
        <CardDescription>Your most recently created tasks</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {recentTasks.map((task) => (
            <TaskCard key={task.id} task={task} workspaceSlug={slug} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
