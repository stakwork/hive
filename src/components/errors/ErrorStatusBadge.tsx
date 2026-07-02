import React from "react";
import { Badge } from "@/components/ui/badge";
import type { ErrorIssueStatus } from "@/types/error-issues";

interface ErrorStatusBadgeProps {
  status: ErrorIssueStatus;
  className?: string;
}

const STATUS_CONFIG: Record<ErrorIssueStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  UNRESOLVED: { label: "Unresolved", variant: "destructive" },
  RESOLVED: { label: "Resolved", variant: "secondary" },
  IGNORED: { label: "Ignored", variant: "outline" },
};

export function ErrorStatusBadge({ status, className }: ErrorStatusBadgeProps) {
  const { label, variant } = STATUS_CONFIG[status] ?? STATUS_CONFIG.UNRESOLVED;
  return (
    <Badge variant={variant} className={className} data-testid="error-status-badge">
      {label}
    </Badge>
  );
}
