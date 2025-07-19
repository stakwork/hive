import { STEPS_ARRAY, TWizardStep } from "@/stores/useWizardStore";
import { WizardStep } from "@/types/wizard";
import { CheckCircle, Circle, Loader2 } from "lucide-react";

interface WizardProgressProps {
  currentStep: TWizardStep;
  totalSteps?: number;
  stepStatus?: string;
}

export function WizardProgress({ currentStep, totalSteps = 9, stepStatus }: WizardProgressProps) {
  const steps = Array.from({ length: totalSteps }, (_, i) => i + 1);
  const currentStepIndex = STEPS_ARRAY.indexOf(currentStep);

  const getStepIcon = (stepNumber: number) => {
    if (stepNumber < currentStepIndex) {
      return <CheckCircle className="w-5 h-5 text-white" />;
    }
    if (stepNumber === currentStepIndex) {
      if (stepStatus === 'PROCESSING' || stepStatus === 'STARTED') {
        return <Loader2 className="w-5 h-5 text-white animate-spin" />;
      }
      if (stepStatus === 'COMPLETED') {
        return <CheckCircle className="w-5 h-5 text-white" />;
      }
      return <Circle className="w-5 h-5 text-white fill-current" />;
    }
    return <Circle className="w-5 h-5 text-gray-400" />;
  };

  const getStepStyle = (stepNumber: number) => {
    if (stepNumber < currentStepIndex) {
      return "bg-green-600 text-white border-green-600";
    }
    if (stepNumber === currentStepIndex) {
      if (stepStatus === 'PROCESSING' || stepStatus === 'STARTED') {
        return "bg-blue-600 text-white border-blue-600";
      }
      if (stepStatus === 'COMPLETED') {
        return "bg-green-600 text-white border-green-600";
      }
      if (stepStatus === 'FAILED') {
        return "bg-red-600 text-white border-red-600";
      }
      return "bg-blue-600 text-white border-blue-600";
    }
    return "bg-gray-200 text-gray-600 border-gray-200";
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-center space-x-2 sm:space-x-4 overflow-x-auto pb-4">
        {steps.map((stepNumber) => (
          <div key={stepNumber} className="flex items-center flex-shrink-0">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${getStepStyle(stepNumber)}`}
            >
              {getStepIcon(stepNumber)}
            </div>
            {stepNumber < totalSteps && (
              <div
                className={`w-8 sm:w-12 h-1 mx-1 sm:mx-2 ${
                  currentStepIndex > stepNumber ? "bg-green-600" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
} 