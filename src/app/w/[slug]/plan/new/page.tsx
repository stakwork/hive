"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { PlanStartInput } from "./components";
import { toast } from "sonner";

export default function NewPlanPage() {
  const router = useRouter();
  const { id: workspaceId, slug: workspaceSlug } = useWorkspace();
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (message: string) => {
    setIsLoading(true);
    try {
      // 1. Create Feature record
      const featureRes = await fetch("/api/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: message.slice(0, 100), workspaceId }),
      });

      if (!featureRes.ok) {
        throw new Error("Failed to create feature");
      }

      const { data: feature } = await featureRes.json();

      // 2. Send first chat message + trigger Stakwork workflow
      const chatRes = await fetch(`/api/features/${feature.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      if (!chatRes.ok) {
        console.error("Failed to send initial message, but feature was created");
      }

      // 3. Navigate to the plan chat view
      router.push(`/w/${workspaceSlug}/plan/${feature.id}`);
    } catch (error) {
      console.error("Error creating plan:", error);
      toast.error("Failed to create plan. Please try again.");
      setIsLoading(false);
    }
  };

  return <PlanStartInput onSubmit={handleSubmit} isLoading={isLoading} />;
}
