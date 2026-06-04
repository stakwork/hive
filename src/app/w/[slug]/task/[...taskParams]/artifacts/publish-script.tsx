"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Artifact, PublishScriptContent } from "@/lib/chat";
import { Upload, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function PublishScriptArtifact({
  artifact,
  taskId,
}: {
  artifact: Artifact;
  taskId?: string;
}) {
  const content = artifact.content as PublishScriptContent;
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPublished, setIsPublished] = useState(content.published === true);

  const handlePublish = async () => {
    if (!content.scriptId || !content.scriptVersionId) {
      toast.error("Missing script ID or version ID");
      return;
    }

    setIsPublishing(true);

    try {
      const response = await fetch(
        `/api/workflow/scripts/${content.scriptId}/versions/${content.scriptVersionId}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artifactId: artifact.id }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to publish script");
      }

      const result = await response.json();

      if (result.success) {
        setIsPublished(true);
        toast.success("Script published successfully");

        if (taskId) {
          await fetch(`/api/tasks/${taskId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "DONE" }),
          });
        }
      } else {
        throw new Error(result.error || "Failed to publish script");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to publish script", { description: errorMessage });
    } finally {
      setIsPublishing(false);
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
              Publish Script
            </div>
            <div className="text-sm text-muted-foreground truncate">
              {content.scriptName || `Script ${content.scriptVersionId}`}
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
              <Button
                onClick={handlePublish}
                size="sm"
                className="gap-2"
                disabled={isPublishing}
              >
                {isPublishing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Publishing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Publish
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
