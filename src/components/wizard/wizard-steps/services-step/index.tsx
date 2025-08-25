import ServicesForm from "@/components/stakgraph/forms/ServicesForm";
import { ServiceDataConfig } from "@/components/stakgraph/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useWizardStore } from "@/stores/useWizardStore";
import { useCallback, useEffect, useState } from "react";

interface ServicesStepProps {
  onNext: () => void;
  onBack: () => void;
}

export const ServicesStep = ({ onNext, onBack }: ServicesStepProps) => {
  const services = useWizardStore((s) => s.services);
  const setServices = useWizardStore((s) => s.setServices);
  const workspaceId = useWizardStore((s) => s.workspaceId);
  const swarmId = useWizardStore((s) => s.swarmId);
  const [loading, setLoading] = useState(false);

  const handleServices = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/swarm/stakgraph/services?workspaceId=${encodeURIComponent(
          workspaceId,
        )}&swarmId=${encodeURIComponent(swarmId!)}&clone=true`,
      );
      const data = await res.json();

      console.log(data, 'data--data')


      setServices(data.data.services);

    } catch (error) {
      console.error("Polling error:", error);
    }
  }, [workspaceId, swarmId, setServices]);

  const onServicesChange = useCallback(
    (data: ServiceDataConfig[]) => {
      setServices(data);
    },
    [setServices],
  );

  const handleNext = useCallback(async () => {
    try {
      await fetch("/api/swarm", {
        method: "PUT",
        body: JSON.stringify({
          services: services,
          swarmId: swarmId,
          workspaceId: workspaceId,
        }),
      });

      onNext();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [onNext, services, workspaceId, swarmId]);

  useEffect(() => {
    handleServices();
  }, [handleServices]);

  return (
    <Card className="max-w-2xl mx-auto bg-card text-card-foreground">
      <CardHeader className="text-center">
        <div className="flex items-center justify-center mx-auto mb-4">
          <svg
            width="64"
            height="64"
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect
              x="12"
              y="20"
              width="40"
              height="24"
              rx="6"
              fill="#F3F4F6"
              stroke="#60A5FA"
              strokeWidth="2"
            />
            <path
              d="M24 32h16"
              stroke="#2563EB"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="32" cy="32" r="4" fill="#60A5FA" />
          </svg>
        </div>
        <CardTitle className="text-2xl">Add Services</CardTitle>
        <CardDescription>
          Define your services, ports, and scripts for your project.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ServicesForm
          data={services ?? []}
          loading={false}
          onChange={(partial) => onServicesChange(partial)}
        />
        <div className="flex justify-between pt-6">
          <Button variant="outline" type="button" onClick={() => onBack()}>
            Back
          </Button>
          <Button
            disabled={loading}
            className="px-8 bg-primary text-primary-foreground hover:bg-primary/90"
            type="button"
            onClick={handleNext}
          >
            Next
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default ServicesStep;
