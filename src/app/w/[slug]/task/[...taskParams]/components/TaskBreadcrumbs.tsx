"use client";

import { useRouter } from "next/navigation";

interface TaskBreadcrumbsProps {
  featureId: string | null;
  featureTitle: string | null;
  workspaceSlug: string;
}

export default function TaskBreadcrumbs({
  featureId,
  featureTitle,
  workspaceSlug,
}: TaskBreadcrumbsProps) {
  const router = useRouter();

  if (!featureId || !featureTitle) {
    return null;
  }

  return (
    <div className="text-sm text-muted-foreground">
      <span
        className="hover:underline cursor-pointer"
        onClick={() => router.push(`/w/${workspaceSlug}/plan/${featureId}`)}
      >
        {featureTitle}
      </span>
      <span className="mx-2">›</span>
      <span>Task</span>
    </div>
  );
}
