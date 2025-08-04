import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight } from "lucide-react";
import { useWizardStore } from "@/stores/useWizardStore";

interface ProjectNameStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function ProjectNameStep({ onNext, onBack }: ProjectNameStepProps) {
  const projectName = useWizardStore((s) => s.projectName);
  const setProjectName = useWizardStore((s) => s.setProjectName);

  return (
    <Card className="max-w-2xl mx-auto bg-card text-card-foreground">
      <CardHeader className="text-center">
        <div className="flex items-center justify-center mx-auto mb-4">
          {/* Animated Paper and Pen SVG */}
          <svg
            width="64"
            height="64"
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Paper */}
            <rect
              x="12"
              y="16"
              width="40"
              height="32"
              rx="4"
              fill="#F3F4F6"
              stroke="#D1D5DB"
              strokeWidth="2"
              filter="url(#shadow)"
            />
            <defs>
              <filter
                id="shadow"
                x="0"
                y="0"
                width="64"
                height="64"
                filterUnits="userSpaceOnUse"
              >
                <feDropShadow
                  dx="0"
                  dy="2"
                  stdDeviation="2"
                  floodColor="#000"
                  floodOpacity="0.10"
                />
              </filter>
            </defs>
            {/* Pen body */}
            <rect x="38" y="40" width="14" height="4" rx="2" fill="#6366F1">
              <animate
                attributeName="x"
                values="38;32;38"
                dur="1.2s"
                repeatCount="indefinite"
              />
            </rect>
            {/* Pen tip */}
            <polygon points="52,42 56,42 54,46" fill="#F59E42">
              <animate
                attributeName="points"
                values="52,42 56,42 54,46;46,42 50,42 48,46;52,42 56,42 54,46"
                dur="1.2s"
                repeatCount="indefinite"
              />
            </polygon>
            {/* Pen shadow */}
            <ellipse cx="45" cy="48" rx="7" ry="2" fill="#D1D5DB" opacity="0.4">
              <animate
                attributeName="cx"
                values="45;39;45"
                dur="1.2s"
                repeatCount="indefinite"
              />
            </ellipse>
            {/* Paper lines */}
            <rect x="18" y="24" width="28" height="2" rx="1" fill="#E5E7EB" />
            <rect x="18" y="30" width="20" height="2" rx="1" fill="#E5E7EB" />
            <rect x="18" y="36" width="24" height="2" rx="1" fill="#E5E7EB" />
          </svg>
        </div>
        <CardTitle className="text-2xl">Name Your Project</CardTitle>
        <CardDescription>Enter a name for your project.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label
            htmlFor="projectName"
            className="text-sm font-medium text-foreground"
          >
            Project Name
          </Label>
          <Input
            id="projectName"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. my-awesome-project"
            className="mt-2"
            autoFocus
          />
        </div>
        <div className="flex justify-between pt-4">
          <Button variant="outline" type="button" onClick={onBack}>
            Back
          </Button>
          <Button
            className="px-8 bg-primary text-primary-foreground hover:bg-primary/90"
            type="button"
            onClick={onNext}
            disabled={!projectName.trim()}
          >
            Next
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
