"use client";

import { useModal } from "@/components/modals/ModlaProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useInsightsStore } from "@/stores/useInsightsStore";
import { Bot } from "lucide-react";

export function TaskCoordinatorCard() {
  const { workspace } = useWorkspace();
  const { taskCoordinatorEnabled, toggleTaskCoordinator } = useInsightsStore();
  const { toast } = useToast();
  const open = useModal();

  const handleToggle = async () => {
    if (!workspace?.slug) return;

    if (workspace?.poolState !== "COMPLETE") {
      open("ServicesWizard");
      return;
    }

    try {
      await toggleTaskCoordinator(workspace.slug);
      toast({
        title: taskCoordinatorEnabled ? "Task Coordinator disabled" : "Task Coordinator enabled",
        description: taskCoordinatorEnabled
          ? "Recommendations will no longer be automatically accepted"
          : "High-priority recommendations will be automatically accepted when pods are available",
      });
    } catch (error) {
      console.error("Error toggling Task Coordinator:", error);
      toast({
        title: "Error",
        description: "Failed to toggle Task Coordinator",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-blue-500" />
          Task Coordinator
        </CardTitle>
        <CardDescription>
          Automatically accept high-priority recommendations when pods are available
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center space-x-2">
          <Switch
            id="task-coordinator"
            className="data-[state=checked]:bg-green-500"
            checked={taskCoordinatorEnabled}
            onCheckedChange={handleToggle}
          />
          <Label htmlFor="task-coordinator">
            {taskCoordinatorEnabled ? "Enabled" : "Disabled"}
          </Label>
        </div>
        {taskCoordinatorEnabled && (
          <p className="text-sm text-muted-foreground mt-2">
            ✓ Monitoring available pods every 5 minutes for automatic task creation
          </p>
        )}
      </CardContent>
    </Card>
  );
}