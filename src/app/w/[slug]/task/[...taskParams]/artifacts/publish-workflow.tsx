"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Artifact, PublishWorkflowContent } from "@/lib/chat";
import { Upload, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function PublishWorkflowArtifact({ artifact }: { artifact: Artifact }) {
  const content = artifact.content as PublishWorkflowContent;
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPublished, setIsPublished] = useState(content.published === true);

  const handlePublish = async () => {
    if (!content.workflowId) {
      toast.error("Missing workflow ID");
      return;
    }

    setIsPublishing(true);

    try {
      const response = await fetch(`/api/workflow/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workflowId: content.workflowId,
          workflowRefId: content.workflowRefId,
          artifactId: artifact.id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to publish workflow");
      }

      const result = await response.json();

      if (result.success) {
        setIsPublished(true);
        toast.success("Workflow published successfully");
      } else {
        throw new Error(result.error || "Failed to publish workflow");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to publish workflow", { description: errorMessage });
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
            <div className={`w-10 h-10 rounded-full ${config.iconBgColor} flex items-center justify-center`}>
              <IconComponent className={`w-5 h-5 ${config.iconColor}`} />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground mb-1">Publish Workflow</div>
            <div className="text-sm text-muted-foreground truncate">
              {content.workflowName || `Workflow ${content.workflowId}`}
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
