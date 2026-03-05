"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { PlanStartInput } from "./components";
import { toast } from "sonner";

type Attachment = { path: string; filename: string; mimeType: string; size: number };

async function uploadImages(images: File[], entityId: string, isFeature: boolean): Promise<Attachment[]> {
  const attachments: Attachment[] = [];
  for (const image of images) {
    const presignedRes = await fetch("/api/upload/presigned-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        [isFeature ? "featureId" : "taskId"]: entityId,
        filename: image.name,
        contentType: image.type,
        size: image.size,
      }),
    });
    if (!presignedRes.ok) throw new Error("Failed to get presigned URL");
    const { presignedUrl, s3Path } = await presignedRes.json();
    const uploadRes = await fetch(presignedUrl, {
      method: "PUT",
      headers: { "Content-Type": image.type },
      body: image,
    });
    if (!uploadRes.ok) throw new Error("Failed to upload image");
    attachments.push({ path: s3Path, filename: image.name, mimeType: image.type, size: image.size });
  }
  return attachments;
}

export default function NewPlanPage() {
  const router = useRouter();
  const { id: workspaceId, slug: workspaceSlug } = useWorkspace();
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (
    message: string,
    options?: { isPrototype: boolean; selectedRepoId: string | null },
    images?: File[],
  ) => {
    setIsLoading(true);
    try {
      if (options?.isPrototype) {
        // Prototype flow: create a PROTOTYPE task and redirect to task chat
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: message.slice(0, 100),
            workspaceSlug,
            sourceType: "PROTOTYPE",
            repositoryId: options.selectedRepoId,
            mode: "live",
          }),
        });

        if (!res.ok) {
          throw new Error("Failed to create prototype task");
        }

        const { data: task } = await res.json();

        // Upload images if present
        let attachments: Attachment[] = [];
        if (images && images.length > 0) {
          try {
            attachments = await uploadImages(images, task.id, false);
          } catch (err) {
            console.error("Image upload failed:", err);
            toast.error("Failed to upload images, but task was created");
          }
        }

        // Send the first message to trigger the Stakwork workflow
        const chatRes = await fetch("/api/chat/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: task.id,
            message,
            mode: "live",
            ...(attachments.length > 0 && { attachments }),
          }),
        });

        if (!chatRes.ok) {
          console.error("Failed to send initial prototype message, but task was created");
        }

        router.push(`/w/${workspaceSlug}/task/${task.id}`);
        return;
      }

      // Standard feature creation flow
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

      // Upload images if present
      let attachments: Attachment[] = [];
      if (images && images.length > 0) {
        try {
          attachments = await uploadImages(images, feature.id, true);
        } catch (err) {
          console.error("Image upload failed:", err);
          toast.error("Failed to upload images, but feature was created");
        }
      }

      // 2. Send first chat message + trigger Stakwork workflow
      const chatRes = await fetch(`/api/features/${feature.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          ...(attachments.length > 0 && { attachments }),
        }),
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
