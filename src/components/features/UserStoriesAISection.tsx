"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Sparkles, Check, X, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { UserStoriesSection } from "./UserStoriesSection";
import { GenerationControls } from "./GenerationControls";
import { DeepResearchProgress } from "./DeepResearchProgress";
import { ClarifyingQuestionsPreview } from "./ClarifyingQuestionsPreview";
import { useStakworkGeneration } from "@/hooks/useStakworkGeneration";
import { useAIGeneration } from "@/hooks/useAIGeneration";
import { useWorkspace } from "@/hooks/useWorkspace";
import { isClarifyingQuestions, type ClarifyingQuestionsResponse } from "@/types/stakwork";
import type { FeatureDetail } from "@/types/roadmap";

interface UserStory {
  title: string;
}

interface UserStoriesAISectionProps {
  featureId: string;
  userStories: FeatureDetail["userStories"];
  newStoryTitle: string;
  creatingStory: boolean;
  onNewStoryTitleChange: (title: string) => void;
  onAddUserStory: () => void;
  onDeleteUserStory: (storyId: string) => void;
  onUpdateUserStory: (storyId: string, title: string) => Promise<void>;
  onReorderUserStories: (stories: FeatureDetail["userStories"]) => void;
  onAcceptGeneratedStory: (title: string) => Promise<void>;
  shouldFocusRef: React.MutableRefObject<boolean>;
}

export function UserStoriesAISection({
  featureId,
  userStories,
  newStoryTitle,
  creatingStory,
  onNewStoryTitleChange,
  onAddUserStory,
  onDeleteUserStory,
  onUpdateUserStory,
  onReorderUserStories,
  onAcceptGeneratedStory,
  shouldFocusRef,
}: UserStoriesAISectionProps) {
  const { workspace } = useWorkspace();
  const [initiatingDeepThink, setInitiatingDeepThink] = useState(false);
  const [acceptingAll, setAcceptingAll] = useState(false);

  // Integrate Stakwork generation hook for deep research
  const { latestRun, refetch } = useStakworkGeneration({
    featureId,
    type: "USER_STORIES",
    enabled: true,
  });

  // Integrate AI generation hook for accept/reject workflow
  const aiGeneration = useAIGeneration({
    featureId,
    workspaceId: workspace?.id || "",
    type: "USER_STORIES",
    displayName: "user stories",
    enabled: true,
  });

  // Auto-populate content when deep research completes
  useEffect(() => {
    if (latestRun?.status === "COMPLETED" && !latestRun.decision && latestRun.result) {
      aiGeneration.setContent(latestRun.result, "deep", latestRun.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestRun]);

  // Parse content to detect clarifying questions or user stories
  const parsedContent = useMemo(() => {
    if (!aiGeneration.content) return null;
    try {
      const parsed = JSON.parse(aiGeneration.content);
      if (isClarifyingQuestions(parsed)) {
        return { type: "questions" as const, data: parsed as ClarifyingQuestionsResponse };
      }
      // Check if it's an array of user stories
      if (Array.isArray(parsed)) {
        return { type: "stories" as const, data: parsed as UserStory[] };
      }
    } catch {
      // Not JSON, ignore
    }
    return null;
  }, [aiGeneration.content]);

  const handleDeepThink = async () => {
    try {
      setInitiatingDeepThink(true);
      await aiGeneration.regenerate(false);
      await refetch();
    } catch (error) {
      console.error("Deep think failed:", error);
    } finally {
      setInitiatingDeepThink(false);
    }
  };

  const handleRetry = async () => {
    try {
      setInitiatingDeepThink(true);
      await aiGeneration.regenerate(true);
      await refetch();
    } catch (error) {
      console.error("Retry failed:", error);
    } finally {
      setInitiatingDeepThink(false);
    }
  };

  const handleProvideFeedback = async (feedback: string) => {
    await aiGeneration.provideFeedback(feedback);
  };

  const handleAcceptAll = async () => {
    if (!parsedContent || parsedContent.type !== "stories") return;

    try {
      setAcceptingAll(true);

      // Batch-create all generated user stories
      for (const story of parsedContent.data) {
        if (story.title && typeof story.title === "string") {
          await onAcceptGeneratedStory(story.title);
        }
      }

      // Accept the generation (persists decision if from deep research)
      await aiGeneration.accept();

      toast.success("User stories accepted", {
        description: `Added ${parsedContent.data.length} user stories to the feature.`,
      });
    } catch (error) {
      console.error("Failed to accept user stories:", error);
      toast.error("Failed to accept user stories", {
        description: error instanceof Error ? error.message : "An error occurred",
      });
    } finally {
      setAcceptingAll(false);
    }
  };

  const handleRejectAll = async () => {
    await aiGeneration.reject();
  };

  const isErrorState = latestRun?.status && ["FAILED", "ERROR", "HALTED"].includes(latestRun.status);
  const isLoadingState = initiatingDeepThink || (latestRun?.status && ["PENDING", "IN_PROGRESS"].includes(latestRun.status));

  // Show deep research progress
  if (latestRun?.status === "IN_PROGRESS" && latestRun.projectId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-base font-semibold">User Stories</label>
          <GenerationControls
            onQuickGenerate={() => {}}
            onDeepThink={handleDeepThink}
            onRetry={handleRetry}
            status={latestRun?.status}
            isLoading={aiGeneration.isLoading}
            isQuickGenerating={false}
            disabled={true}
            showDeepThink={true}
          />
        </div>
        <DeepResearchProgress projectId={latestRun.projectId} />
      </div>
    );
  }

  // Show clarifying questions
  if (parsedContent?.type === "questions") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-base font-semibold">User Stories</label>
          <GenerationControls
            onQuickGenerate={() => {}}
            onDeepThink={handleDeepThink}
            onRetry={handleRetry}
            status={latestRun?.status}
            isLoading={aiGeneration.isLoading}
            isQuickGenerating={false}
            disabled={true}
            showDeepThink={true}
          />
        </div>
        <ClarifyingQuestionsPreview
          questions={parsedContent.data.content}
          onSubmit={(formattedAnswers) => handleProvideFeedback(formattedAnswers)}
          isLoading={aiGeneration.isLoading}
        />
      </div>
    );
  }

  // Show generated user stories preview
  if (parsedContent?.type === "stories") {
    const Icon = aiGeneration.source === "quick" ? Sparkles : Brain;
    const iconColor = aiGeneration.source === "quick" ? "text-purple-500" : "text-purple-600";

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-base font-semibold">User Stories</label>
          <GenerationControls
            onQuickGenerate={() => {}}
            onDeepThink={handleDeepThink}
            onRetry={handleRetry}
            status={latestRun?.status}
            isLoading={aiGeneration.isLoading}
            isQuickGenerating={false}
            disabled={true}
            showDeepThink={true}
          />
        </div>

        {/* Generated Stories Preview */}
        <div className="relative rounded-md border border-border bg-muted/50 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="p-4 space-y-2">
            <div className="flex items-center gap-2 mb-3">
              <Icon className={`h-4 w-4 ${iconColor}`} />
              <span className="text-sm font-medium">
                {parsedContent.data.length} Generated User {parsedContent.data.length === 1 ? "Story" : "Stories"}
              </span>
            </div>
            {parsedContent.data.map((story, index) => (
              <div
                key={index}
                className="flex items-center gap-3 px-4 py-3 rounded-md border border-border bg-background"
              >
                <span className="flex-1 text-sm">{story.title}</span>
              </div>
            ))}
          </div>

          {/* Action Bar */}
          <div className="bg-background/95 backdrop-blur-sm border-t border-border/50 rounded-b-md p-4">
            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={handleAcceptAll}
                disabled={acceptingAll || aiGeneration.isLoading}
                className="hover:bg-green-50 dark:hover:bg-green-950/20"
              >
                <Check className="h-4 w-4 mr-2 text-green-600 dark:text-green-500" />
                Accept All
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRejectAll}
                disabled={acceptingAll || aiGeneration.isLoading}
                className="hover:bg-red-50 dark:hover:bg-red-950/20"
              >
                <X className="h-4 w-4 mr-2 text-red-600 dark:text-red-500" />
                Reject All
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default: Show UserStoriesSection with Deep Research button
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-base font-semibold">User Stories</label>
        <GenerationControls
          onQuickGenerate={() => {}}
          onDeepThink={handleDeepThink}
          onRetry={handleRetry}
          status={latestRun?.status}
          isLoading={aiGeneration.isLoading}
            isQuickGenerating={false}
            disabled={isLoadingState}
            showDeepThink={true}
          />
      </div>

      {/* Existing UserStoriesSection with quick generate */}
      <UserStoriesSection
        featureId={featureId}
        userStories={userStories}
        newStoryTitle={newStoryTitle}
        creatingStory={creatingStory}
        onNewStoryTitleChange={onNewStoryTitleChange}
        onAddUserStory={onAddUserStory}
        onDeleteUserStory={onDeleteUserStory}
        onUpdateUserStory={onUpdateUserStory}
        onReorderUserStories={onReorderUserStories}
        onAcceptGeneratedStory={onAcceptGeneratedStory}
        shouldFocusRef={shouldFocusRef}
      />
    </div>
  );
}
