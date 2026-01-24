"use client";

import { useRouter } from "next/navigation";

interface TaskBreadcrumbsProps {
  featureId: string | null;
  featureTitle: string | null;
  workspaceSlug: string;
}

const MAX_FEATURE_TITLE_LENGTH = 40;

export default function TaskBreadcrumbs({
  featureId,
  featureTitle,
  workspaceSlug,
}: TaskBreadcrumbsProps) {
  const router = useRouter();

  if (!featureId || !featureTitle) {
    return null;
  }

  const truncatedTitle = featureTitle.length > MAX_FEATURE_TITLE_LENGTH 
    ? `${featureTitle.slice(0, MAX_FEATURE_TITLE_LENGTH)}...` 
    : featureTitle;

  return (
    <div className="text-sm text-muted-foreground">
      <span
        className="hover:underline cursor-pointer"
        onClick={() => router.push(`/w/${workspaceSlug}/plan/${featureId}?tab=tasks`)}
        title={featureTitle}
      >
        {truncatedTitle}
      </span>
    </div>
  );
}
