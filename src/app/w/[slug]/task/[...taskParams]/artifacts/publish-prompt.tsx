"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Artifact, PublishPromptContent } from "@/lib/chat";
import { Upload, CheckCircle2, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/hooks/useWorkspace";

export function PublishPromptArtifact({
  artifact,
  taskId,
}: {
  artifact: Artifact;
  taskId?: string;
}) {
  const content = artifact.content as PublishPromptContent;
  const { slug } = useWorkspace();
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPublished, setIsPublished] = useState(content.published === true);

  const handlePublish = async () => {
    if (!content.promptId || !content.promptVersionId) {
      toast.error("Missing prompt ID or version ID");
      return;
    }

    setIsPublishing(true);

    try {
      const response = await fetch(
        `/api/workflow/prompts/${content.promptId}/versions/${content.promptVersionId}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artifactId: artifact.id }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to publish prompt");
      }

      const result = await response.json();

      if (result.success) {
        setIsPublished(true);
        toast.success("Prompt published successfully");

        if (taskId) {
          await fetch(`/api/tasks/${taskId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "DONE" }),
          });
        }
      } else {
        throw new Error(result.error || "Failed to publish prompt");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to publish prompt", { description: errorMessage });
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
              Publish Prompt
            </div>
            <div className="text-sm text-muted-foreground truncate">
              {content.promptName || `Prompt v${content.promptVersionId}`}
            </div>
            {content.promptVersionId && (
              <div className="flex items-center gap-1 mt-1">
                <span
                  data-testid="prompt-version-chip"
                  className="font-mono text-xs text-muted-foreground"
                >
                  v{content.promptVersionId}
                </span>
                <a
                  data-testid="prompt-version-link"
                  href={`/w/${slug}/prompts?prompt=${content.promptId}&version=${content.promptVersionId}`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="View prompt version"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
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
