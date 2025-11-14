"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";

export type TutorialStep = 
  | "welcome"
  | "ingestion"
  | "navigate-to-tasks"
  | "create-task"
  | "navigate-to-insights"
  | "insights-explanation"
  | "complete";

interface TutorialContextValue {
  isActive: boolean;
  currentStep: TutorialStep;
  nextStep: () => void;
  skipTutorial: () => void;
  completeTutorial: () => void;
}

const TutorialContext = createContext<TutorialContextValue | undefined>(undefined);

interface TutorialProviderProps {
  children: ReactNode;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  "welcome",
  "ingestion",
  "navigate-to-tasks",
  "create-task",
  "navigate-to-insights",
  "insights-explanation",
  "complete",
];

export function TutorialProvider({ children }: TutorialProviderProps) {
  const { workspace } = useWorkspace();
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState<TutorialStep>("welcome");

  // Check if tutorial should be shown (only for new workspaces)
  useEffect(() => {
    if (workspace) {
      // Show tutorial if not completed and workspace is new (within 5 minutes)
      const isNewWorkspace = workspace.createdAt && 
        (Date.now() - new Date(workspace.createdAt).getTime()) < 5 * 60 * 1000;
      
      const shouldShowTutorial = !workspace.tutorialCompleted && isNewWorkspace;
      setIsActive(shouldShowTutorial);
    }
  }, [workspace]);

  const nextStep = () => {
    const currentIndex = TUTORIAL_STEPS.indexOf(currentStep);
    if (currentIndex < TUTORIAL_STEPS.length - 1) {
      setCurrentStep(TUTORIAL_STEPS[currentIndex + 1]);
    } else {
      completeTutorial();
    }
  };

  const skipTutorial = async () => {
    if (!workspace?.slug) return;
    
    try {
      await fetch(`/api/workspaces/${workspace.slug}/tutorial/skip`, {
        method: "POST",
      });
      setIsActive(false);
    } catch (error) {
      console.error("Failed to skip tutorial:", error);
    }
  };

  const completeTutorial = async () => {
    if (!workspace?.slug) return;
    
    try {
      await fetch(`/api/workspaces/${workspace.slug}/tutorial/complete`, {
        method: "POST",
      });
      setIsActive(false);
      setCurrentStep("complete");
    } catch (error) {
      console.error("Failed to complete tutorial:", error);
    }
  };

  return (
    <TutorialContext.Provider
      value={{
        isActive,
        currentStep,
        nextStep,
        skipTutorial,
        completeTutorial,
      }}
    >
      {children}
    </TutorialContext.Provider>
  );
}

export function useTutorial() {
  const context = useContext(TutorialContext);
  if (context === undefined) {
    throw new Error("useTutorial must be used within a TutorialProvider");
  }
  return context;
}
