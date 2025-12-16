import type { WorkflowTransition } from "@/types/stakwork/workflow";

// Step type enum for UI display
export type StepType = "automated" | "human" | "api" | "loop" | "condition";

// Selected step content for chat attachment and modal display
export interface SelectedStepContent {
  uniqueId: string;
  name: string;
  displayName?: string;
  displayId: string;
  stepType: StepType;
  alias?: string;
  wizardStep?: boolean;
  // Full step data for context
  stepData: WorkflowTransition;
}

// Helper to extract step type from WorkflowTransition
export function getStepType(step: WorkflowTransition): StepType {
  if (step.name === "IfCondition" || step.name === "IfElseCondition") {
    return "condition";
  }

  const skillType = step.skill?.type;
  if (skillType === "human" || skillType === "automated" || skillType === "api" || skillType === "loop") {
    return skillType;
  }

  return "automated";
}

// Helper to create SelectedStepContent from WorkflowTransition
export function createSelectedStep(step: WorkflowTransition): SelectedStepContent {
  return {
    uniqueId: step.unique_id,
    name: step.name,
    displayName: step.display_name,
    displayId: step.display_id,
    stepType: getStepType(step),
    alias: step.id,
    wizardStep: step.wizard_step,
    stepData: step,
  };
}

// Step type display names
export const STEP_TYPE_LABELS: Record<StepType, string> = {
  automated: "Automated",
  human: "Human",
  api: "API",
  loop: "Loop",
  condition: "Condition",
};
