import React from "react";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Upload } from "lucide-react";

interface PublishStatusBadgeProps {
  type: "PUBLISH_WORKFLOW" | "PUBLISH_SCRIPT" | "PUBLISH_PROMPT";
  published: boolean;
  onClick: () => void;
}

const TYPE_LABELS: Record<PublishStatusBadgeProps["type"], string> = {
  PUBLISH_WORKFLOW: "Workflow",
  PUBLISH_SCRIPT: "Script",
  PUBLISH_PROMPT: "Prompt",
};

export function PublishStatusBadge({ type, published, onClick }: PublishStatusBadgeProps) {
  const label = TYPE_LABELS[type];

  return (
    <button
      className="inline-flex cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {published ? (
        <Badge
          variant="secondary"
          className="gap-1 h-5 border-[#238636]/30"
          style={{ backgroundColor: "#238636", color: "white" }}
        >
          <CheckCircle2 className="w-3 h-3" />
          {label} · Published
        </Badge>
      ) : (
        <Badge variant="secondary" className="gap-1 h-5">
          <Upload className="w-3 h-3" />
          {label} · Unpublished
        </Badge>
      )}
    </button>
  );
}
