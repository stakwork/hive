'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ThinkingArtifact, ThinkingStepState } from '@/types/thinking';

interface ThinkingArtifactsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifacts: ThinkingArtifact[];
}

const getStateBadgeConfig = (state?: ThinkingStepState) => {
  switch (state) {
    case 'pending':
      return {
        variant: 'secondary' as const,
        className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
        label: 'Pending',
      };
    case 'running':
      return {
        variant: 'default' as const,
        className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
        label: 'Running',
      };
    case 'complete':
      return {
        variant: 'default' as const,
        className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
        label: 'Complete',
      };
    case 'failed':
      return {
        variant: 'destructive' as const,
        className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
        label: 'Failed',
      };
    default:
      return {
        variant: 'secondary' as const,
        className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
        label: 'Unknown',
      };
  }
};

const CollapsibleSection = ({
  title,
  content,
  defaultOpen = false,
}: {
  title: string;
  content: string;
  defaultOpen?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="mt-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        {title}
      </button>
      {isOpen && (
        <div className="mt-2 ml-5 p-3 bg-gray-50 dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-800 overflow-auto">
          <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words font-mono">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
};

export const ThinkingArtifactsModal = ({
  open,
  onOpenChange,
  artifacts,
}: ThinkingArtifactsModalProps) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const previousArtifactsLengthRef = useRef(artifacts.length);

  // Auto-scroll to bottom when new artifacts arrive
  useEffect(() => {
    if (
      shouldAutoScroll &&
      scrollContainerRef.current &&
      artifacts.length > previousArtifactsLengthRef.current
    ) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
    previousArtifactsLengthRef.current = artifacts.length;
  }, [artifacts.length, shouldAutoScroll]);

  // Handle scroll events to detect manual scrolling
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;

    setShouldAutoScroll(isNearBottom);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Thinking Process</DialogTitle>
          <DialogDescription>
            Real-time workflow execution details and thinking artifacts
          </DialogDescription>
        </DialogHeader>

        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto space-y-4 pr-2"
          data-testid="thinking-artifacts-container"
        >
          {artifacts.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-500 dark:text-gray-400">
              No thinking artifacts available yet...
            </div>
          ) : (
            artifacts.map((artifact) => {
              const badgeConfig = getStateBadgeConfig(artifact.stepState);

              return (
                <div
                  key={artifact.stepId}
                  className="border border-gray-200 dark:border-gray-800 rounded-lg p-4 bg-white dark:bg-gray-950 shadow-sm transition-all duration-200 hover:shadow-md"
                  data-testid={`thinking-artifact-${artifact.stepId}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3
                      className="text-base font-semibold text-gray-900 dark:text-gray-100 break-words"
                      data-testid="artifact-step-name"
                    >
                      {artifact.stepName}
                    </h3>
                    <Badge
                      variant={badgeConfig.variant}
                      className={cn(
                        'shrink-0 transition-colors duration-200',
                        badgeConfig.className
                      )}
                      data-testid="artifact-state-badge"
                    >
                      {badgeConfig.label}
                    </Badge>
                  </div>

                  {artifact.log && (
                    <CollapsibleSection
                      title="Log"
                      content={artifact.log}
                      defaultOpen={false}
                    />
                  )}

                  {artifact.output && (
                    <CollapsibleSection
                      title="Output"
                      content={artifact.output}
                      defaultOpen={false}
                    />
                  )}

                  {!artifact.log && !artifact.output && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                      No additional details available
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
