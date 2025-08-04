import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight } from "lucide-react";
import { useWizardStore } from "@/stores/useWizardStore";
import { useCallback, useEffect, useState } from "react";

interface EnvironmentSetupStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function EnvironmentSetupStep({
  onNext,
  onBack,
}: EnvironmentSetupStepProps) {
  const services = useWizardStore((s) => s.services);
  const setEnvVars = useWizardStore((s) => s.setEnvVars);
  const envVars = useWizardStore((s) => s.envVars);
  const workspaceId = useWizardStore((s) => s.workspaceId);
  const [loading, setLoading] = useState(false);
  const [localVars, setLocalVars] = useState<{ name: string; value: string }[]>(
    [],
  );

  // Initialize from services[*].env
  useEffect(() => {
    if (envVars?.length > 0) {
      setLocalVars(envVars);
      return;
    }
    const collectedVars: { name: string; value: string }[] = [];
    services.forEach((service) => {
      Object.entries(service.env || {}).forEach(([key, value]) => {
        collectedVars.push({ name: key, value });
      });
    });
    setLocalVars(
      collectedVars.length > 0 ? collectedVars : [{ name: "", value: "" }],
    );
  }, [services, envVars]);

  const handleChange = (
    index: number,
    field: "name" | "value",
    value: string,
  ) => {
    setLocalVars((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleAdd = () => {
    setLocalVars((prev) => [...prev, { name: "", value: "" }]);
  };

  const handleRemove = (index: number) => {
    setLocalVars((prev) => prev.filter((_, i) => i !== index));
  };

  const handleNext = useCallback(async () => {
    const cleaned = localVars
      .filter((v) => v.name.trim() !== "")
      .map(({ name, value }) => ({ name: name.trim(), value }));
    setEnvVars(cleaned);
    try {
      await fetch("/api/swarm", {
        method: "PUT",
        body: JSON.stringify({
          envVars: cleaned,
          workspaceId: workspaceId,
        }),
      });

      onNext();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [onNext, services, workspaceId, localVars, setEnvVars]);

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader className="text-center">
        <div className="flex items-center justify-center mx-auto mb-4">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <rect x="18" y="28" width="28" height="24" rx="6" fill="#F59E42">
              <animate
                attributeName="fill"
                values="#F59E42;#FBBF24;#F59E42"
                dur="1.2s"
                repeatCount="indefinite"
              />
            </rect>
            <path
              d="M24 28v-6a8 8 0 0 1 16 0v6"
              stroke="#FBBF24"
              strokeWidth="3"
              fill="none"
            >
              <animate
                attributeName="stroke"
                values="#FBBF24;#F59E42;#FBBF24"
                dur="1.2s"
                repeatCount="indefinite"
              />
            </path>
            <circle cx="32" cy="40" r="3" fill="#fff">
              <animate
                attributeName="r"
                values="3;5;3"
                dur="1.2s"
                repeatCount="indefinite"
              />
            </circle>
          </svg>
        </div>
        <CardTitle className="text-2xl">Setting up code environment</CardTitle>
        <CardDescription>
          Add any ENV variables your code environment needs.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {localVars.map((env, idx) => (
          <div key={idx} className="flex gap-2 items-center">
            <Input
              placeholder="KEY"
              value={env.name}
              onChange={(e) => handleChange(idx, "name", e.target.value)}
              className="w-1/3"
            />
            <Input
              placeholder="VALUE"
              value={env.value}
              onChange={(e) => handleChange(idx, "value", e.target.value)}
              className="w-1/2"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => handleRemove(idx)}
              className="px-2"
              disabled={localVars.length === 1}
            >
              Remove
            </Button>
          </div>
        ))}

        <Button type="button" variant="secondary" onClick={handleAdd}>
          Add Variable
        </Button>

        <div className="flex justify-between pt-4">
          <Button variant="outline" type="button" onClick={onBack}>
            Back
          </Button>
          <Button
            disabled={loading}
            className="px-8 bg-green-600 hover:bg-green-700"
            type="button"
            onClick={handleNext}
          >
            Next
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
