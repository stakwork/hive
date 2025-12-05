"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, Circle, XCircle, Loader2 } from "lucide-react";
import type { ThinkingArtifact } from "@/types/stakwork";

interface ThinkingArtifactsDisplayProps {
  artifacts: ThinkingArtifact[];
}

export function ThinkingArtifactsDisplay({ artifacts }: ThinkingArtifactsDisplayProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(stepId)) {
        newSet.delete(stepId);
      } else {
        newSet.add(stepId);
      }
      return newSet;
    });
  };

  const getStatusIcon = (status: ThinkingArtifact["status"]) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case "in_progress":
        return <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-600" />;
      case "pending":
      default:
        return <Circle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: ThinkingArtifact["status"]) => {
    const baseClasses = "px-2 py-0.5 rounded-full text-xs font-medium";
    switch (status) {
      case "completed":
        return <span className={`${baseClasses} bg-green-100 text-green-800`}>Completed</span>;
      case "in_progress":
        return <span className={`${baseClasses} bg-blue-100 text-blue-800`}>In Progress</span>;
      case "failed":
        return <span className={`${baseClasses} bg-red-100 text-red-800`}>Failed</span>;
      case "pending":
      default:
        return <span className={`${baseClasses} bg-gray-100 text-gray-800`}>Pending</span>;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return timestamp;
    }
  };

  if (artifacts.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 space-y-2 border border-border rounded-lg p-4 bg-muted/30">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">
        Research Progress
      </h3>
      <div className="space-y-2">
        {artifacts.map((artifact) => {
          const isExpanded = expandedSteps.has(artifact.stepId);
          return (
            <div
              key={artifact.stepId}
              className="border border-border rounded-md bg-background"
            >
              <button
                onClick={() => toggleStep(artifact.stepId)}
                className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {getStatusIcon(artifact.status)}
                  <span className="text-sm font-medium truncate">
                    {artifact.stepName}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {getStatusBadge(artifact.status)}
                  <span className="text-xs text-muted-foreground">
                    {formatTimestamp(artifact.timestamp)}
                  </span>
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </button>
              {isExpanded && artifact.details && (
                <div className="px-3 pb-3 pt-1 border-t border-border">
                  <p className="text-sm text-muted-foreground italic">
                    {artifact.details}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
