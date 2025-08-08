"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Plus } from "lucide-react";
import { useRouter } from "next/navigation";

interface EmptyStateProps {
  workspaceSlug: string;
}

export function EmptyState({ workspaceSlug }: EmptyStateProps) {
  const router = useRouter();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          No tasks created yet
        </CardTitle>
        <CardDescription>
          Create your first task to start tracking work in this workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => router.push(`/w/${workspaceSlug}/task/new`)}>
          <Plus className="w-4 h-4 mr-2" />
          Create Your First Task
        </Button>
      </CardContent>
    </Card>
  );
}