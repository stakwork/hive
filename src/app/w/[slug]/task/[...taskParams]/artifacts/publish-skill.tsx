"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Artifact, PublishSkillContent } from "@/lib/chat";
import { Upload, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export function PublishSkillArtifact({
  artifact,
  taskId,
}: {
  artifact: Artifact;
  taskId?: string;
}) {
  const content = artifact.content as PublishSkillContent;
  const [isPublished, setIsPublished] = useState(content.published === true);

  const handlePublish = async () => {
    setIsPublished(true);
    toast.success("Skill marked as published");

    if (taskId) {
      await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      });
    }
  };

  const getStatusConfig = () => {
    if (isPublished) {
      return {
        icon: CheckCircle2,
        iconBgColor: "bg-green-600/10",
        iconColor: "text-green-600",
        borderColor: "border-green-600/30",
      };
    }
    return {
      icon: Upload,
      iconBgColor: "bg-primary/10",
      iconColor: "text-primary",
      borderColor: "border-primary/30",
    };
  };

  const config = getStatusConfig();
  const IconComponent = config.icon;

  return (
    <div className="relative">
      <Card className={`p-4 bg-card rounded-lg border ${config.borderColor}`}>
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            <div
              className={`w-10 h-10 rounded-full ${config.iconBgColor} flex items-center justify-center`}
            >
              <IconComponent className={`w-5 h-5 ${config.iconColor}`} />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground mb-1">
              Publish Skill
            </div>
            <div className="text-sm text-muted-foreground truncate">
              {content.skillName || "Skill"}
            </div>
            <div className="text-xs text-muted-foreground/60 mt-0.5">
              Coming soon
            </div>
          </div>
          <div className="flex-shrink-0">
            {isPublished ? (
              <Button
                size="sm"
                className="gap-2 bg-green-600 hover:bg-green-600 text-white cursor-default"
                disabled
              >
                <CheckCircle2 className="w-4 h-4" />
                Published
              </Button>
            ) : (
              <Button onClick={handlePublish} size="sm" className="gap-2">
                <Upload className="w-4 h-4" />
                Publish
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
