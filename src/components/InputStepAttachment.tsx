import { X, Zap, Bot, Globe, RefreshCw, GitBranch } from "lucide-react";
import { SelectedStepContent, STEP_TYPE_LABELS, StepType } from "@/lib/workflow-step";

interface InputStepAttachmentProps {
  step: SelectedStepContent;
  onRemove: () => void;
}

const STEP_TYPE_ICONS: Record<StepType, React.ReactNode> = {
  automated: <Zap className="w-4 h-4" />,
  human: <Bot className="w-4 h-4" />,
  api: <Globe className="w-4 h-4" />,
  loop: <RefreshCw className="w-4 h-4" />,
  condition: <GitBranch className="w-4 h-4" />,
};

const STEP_TYPE_COLORS: Record<StepType, { bg: string; border: string; text: string; icon: string }> = {
  automated: {
    bg: "bg-green-50 dark:bg-green-950",
    border: "border-green-200 dark:border-green-800",
    text: "text-green-900 dark:text-green-100",
    icon: "text-green-600 dark:text-green-400",
  },
  human: {
    bg: "bg-blue-50 dark:bg-blue-950",
    border: "border-blue-200 dark:border-blue-800",
    text: "text-blue-900 dark:text-blue-100",
    icon: "text-blue-600 dark:text-blue-400",
  },
  api: {
    bg: "bg-cyan-50 dark:bg-cyan-950",
    border: "border-cyan-200 dark:border-cyan-800",
    text: "text-cyan-900 dark:text-cyan-100",
    icon: "text-cyan-600 dark:text-cyan-400",
  },
  loop: {
    bg: "bg-purple-50 dark:bg-purple-950",
    border: "border-purple-200 dark:border-purple-800",
    text: "text-purple-900 dark:text-purple-100",
    icon: "text-purple-600 dark:text-purple-400",
  },
  condition: {
    bg: "bg-orange-50 dark:bg-orange-950",
    border: "border-orange-200 dark:border-orange-800",
    text: "text-orange-900 dark:text-orange-100",
    icon: "text-orange-600 dark:text-orange-400",
  },
};

export function InputStepAttachment({ step, onRemove }: InputStepAttachmentProps) {
  const colors = STEP_TYPE_COLORS[step.stepType];
  // name is the skill type (e.g., "JSONBuilder", "SetVar")
  const skillName = step.displayName || step.name;
  const truncatedSkillName = skillName.length > 25 ? `${skillName.slice(0, 25)}...` : skillName;
  // alias is the step identifier (e.g., "json_builder_1", "set_var")
  const stepId = step.alias || step.displayId || "";
  const truncatedStepId = stepId.length > 20 ? `${stepId.slice(0, 20)}...` : stepId;

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm ${colors.bg} ${colors.border}`}>
      <span className={colors.icon}>{STEP_TYPE_ICONS[step.stepType]}</span>
      <div className="flex flex-col leading-tight">
        <span className={`font-medium ${colors.text}`} title={skillName}>{truncatedSkillName}</span>
        {stepId && <span className={`text-xs ${colors.text} opacity-70`} title={stepId}>{truncatedStepId}</span>}
      </div>
      <button
        onClick={onRemove}
        className={`ml-1 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors`}
        title="Remove step selection"
      >
        <X className={`w-3.5 h-3.5 ${colors.icon}`} />
      </button>
    </div>
  );
}
