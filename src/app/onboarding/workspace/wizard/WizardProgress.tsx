import { STEPS_ARRAY, TWizardStep } from "@/stores/useWizardStore";
import { CheckCircle, Circle, Loader2 } from "lucide-react";

interface WizardProgressProps {
  currentStep: TWizardStep;
  totalSteps?: number;
  stepStatus?: string;
}

export function WizardProgress({
  currentStep,
  totalSteps = 9,
  stepStatus,
}: WizardProgressProps) {
  const currentStepIndex = STEPS_ARRAY.indexOf(currentStep);
  const progressPercentage = Math.max(
    0,
    (currentStepIndex / (totalSteps - 1)) * 100,
  );

  const getStepIcon = (isActive: boolean, isPast: boolean) => {
    if (isPast) {
      return <CheckCircle className="w-5 h-5 text-white" />;
    }
    if (isActive) {
      if (stepStatus === "PROCESSING" || stepStatus === "STARTED") {
        return <Loader2 className="w-5 h-5 text-white animate-spin" />;
      }
      if (stepStatus === "COMPLETED") {
        return <CheckCircle className="w-5 h-5 text-white" />;
      }
      return <Circle className="w-5 h-5 text-white fill-current" />;
    }
    return <Circle className="w-5 h-5 text-gray-400" />;
  };

  const getStepStyle = (isActive: boolean, isPast: boolean) => {
    if (isPast) {
      return "bg-green-600 text-white border-green-600";
    }
    if (isActive) {
      if (stepStatus === "PROCESSING" || stepStatus === "STARTED") {
        return "bg-blue-600 text-white border-blue-600";
      }
      if (stepStatus === "COMPLETED") {
        return "bg-green-600 text-white border-green-600";
      }
      if (stepStatus === "FAILED") {
        return "bg-red-600 text-white border-red-600";
      }
      return "bg-blue-600 text-white border-blue-600";
    }
    return "bg-gray-200 text-gray-600 border-gray-200";
  };

  const getVisibleSteps = () => {
    if (totalSteps <= 5) return Array.from({ length: totalSteps }, (_, i) => i);

    const start = Math.max(0, currentStepIndex - 2);
    const end = Math.min(totalSteps - 1, start + 4);
    const adjustedStart = Math.max(0, end - 4);

    return Array.from(
      { length: end - adjustedStart + 1 },
      (_, i) => adjustedStart + i,
    );
  };

  const visibleSteps = getVisibleSteps();
  const showStartEllipsis = visibleSteps[0] > 0;
  const showEndEllipsis =
    visibleSteps[visibleSteps.length - 1] < totalSteps - 1;

  return (
    <div className="max-w-4xl mx-auto px-4">
      {/* Progress bar for small screens */}
      <div className="block sm:hidden mb-4">
        <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
          <span>
            Step {currentStepIndex + 1} of {totalSteps}
          </span>
          <span>{Math.round(progressPercentage)}% Complete</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
      </div>

      {/* Step circles for larger screens */}
      <div className="hidden sm:flex items-center justify-center">
        {showStartEllipsis && (
          <>
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${getStepStyle(false, true)}`}
            >
              {getStepIcon(false, true)}
            </div>
            <span className="mx-2 text-gray-400">···</span>
          </>
        )}

        {visibleSteps.map((stepIndex, idx) => {
          const isActive = stepIndex === currentStepIndex;
          const isPast = stepIndex < currentStepIndex;

          return (
            <div key={stepIndex} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${getStepStyle(isActive, isPast)}`}
              >
                {getStepIcon(isActive, isPast)}
              </div>
              {idx < visibleSteps.length - 1 && (
                <div
                  className={`w-8 h-0.5 mx-2 ${currentStepIndex > stepIndex
                      ? "bg-green-600"
                      : "bg-gray-200"
                    }`}
                />
              )}
            </div>
          );
        })}

        {showEndEllipsis && (
          <>
            <span className="mx-2 text-gray-400">···</span>
            <div className="w-8 h-8 rounded-full flex items-center justify-center border-2 bg-gray-200 text-gray-600 border-gray-200">
              <Circle className="w-5 h-5 text-gray-400" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
