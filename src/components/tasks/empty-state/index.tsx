"use client";

import { useModal } from "@/components/modals/ModlaProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/hooks/useWorkspace";
import { FileText, Plus } from "lucide-react";
import { useRouter } from "next/navigation";

interface EmptyStateProps {
  workspaceSlug: string;
}

export function EmptyState({ workspaceSlug }: EmptyStateProps) {
  const router = useRouter();

  const { workspace } = useWorkspace();

  const open = useModal();

  const handleClick = () => {
    if (workspace?.poolState !== "COMPLETE") {
      open("ServicesWizard");
    } else {
      router.push(`/w/${workspaceSlug}/task/new`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          No tasks created yet
        </CardTitle>
        <CardDescription>Create your first task to start tracking work in this workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleClick}>
          <Plus className="w-4 h-4 mr-2" />
          Create Your First Task
        </Button>
      </CardContent>
    </Card>
  );
}
