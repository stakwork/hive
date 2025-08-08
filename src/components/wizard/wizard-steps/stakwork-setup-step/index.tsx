import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useWizardStore } from "@/stores/useWizardStore";
import { useEffect } from "react";

interface StakworkSetupStepProps {
  onNext: () => void;
}

export const StakworkSetupStep = ({
  onNext
}: StakworkSetupStepProps) => {
  const workspaceId = useWizardStore((s) => s.workspaceId);
  const hasKey = useWizardStore((s) => s.hasKey);



  useEffect(() => {
    const createCustomer = async () => {
      try {
        const data = await fetch("/api/stakwork/create-customer", {
          method: "POST",
          body: JSON.stringify({
            workspaceId,
          }),
        });
        onNext();
        const res = await data.json();
        console.log(res);
      } catch (error) {
        console.error(error);
      }
    };
    if (workspaceId) {
      createCustomer();
    }
  }, [workspaceId, onNext]);

  useEffect(() => {
    if (hasKey) {
      onNext();
    }
  }, [hasKey, onNext]);

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader className="text-center">
        <div className="flex items-center justify-center mx-auto mb-4">
          {/* Animated Chain SVG for workflows - teal/emerald */}
          <svg
            width="96"
            height="40"
            viewBox="0 0 96 40"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Chain links */}
            <circle cx="16" cy="20" r="7" fill="#10B981">
              <animate
                attributeName="r"
                values="7;9;7"
                dur="2.4s"
                repeatCount="indefinite"
              />
            </circle>
            <circle cx="40" cy="20" r="7" fill="#34D399">
              <animate
                attributeName="r"
                values="7;9;7"
                dur="2.4s"
                begin="0.3s"
                repeatCount="indefinite"
              />
            </circle>
            <circle cx="64" cy="20" r="7" fill="#10B981">
              <animate
                attributeName="r"
                values="7;9;7"
                dur="2.4s"
                begin="0.6s"
                repeatCount="indefinite"
              />
            </circle>
            <circle cx="88" cy="20" r="7" fill="#34D399">
              <animate
                attributeName="r"
                values="7;9;7"
                dur="2.4s"
                begin="0.9s"
                repeatCount="indefinite"
              />
            </circle>
            {/* Animated connecting lines */}
            <line
              x1="23"
              y1="20"
              x2="33"
              y2="20"
              stroke="#06B6D4"
              strokeWidth="4"
            >
              <animate
                attributeName="stroke"
                values="#06B6D4;#10B981;#06B6D4"
                dur="2.4s"
                repeatCount="indefinite"
              />
            </line>
            <line
              x1="47"
              y1="20"
              x2="57"
              y2="20"
              stroke="#06B6D4"
              strokeWidth="4"
            >
              <animate
                attributeName="stroke"
                values="#06B6D4;#10B981;#06B6D4"
                dur="2.4s"
                begin="0.3s"
                repeatCount="indefinite"
              />
            </line>
            <line
              x1="71"
              y1="20"
              x2="81"
              y2="20"
              stroke="#06B6D4"
              strokeWidth="4"
            >
              <animate
                attributeName="stroke"
                values="#06B6D4;#10B981;#06B6D4"
                dur="2.4s"
                begin="0.6s"
                repeatCount="indefinite"
              />
            </line>
          </svg>
        </div>
        <CardTitle className="text-2xl">Creating Stakwork Account</CardTitle>
        <CardDescription>
          Stakwork powers the automation engine for your workflows.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label
            htmlFor="stakworkName"
            className="text-sm font-medium text-gray-700"
          >
            Stakwork Customer
          </Label>
        </div>
      </CardContent>
    </Card>
  );
};
