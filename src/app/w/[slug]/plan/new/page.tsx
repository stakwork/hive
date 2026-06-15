"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { PlanStartInput } from "./components";
import { toast } from "sonner";
import { uploadFileToS3, type UploadedFileResult } from "@/lib/upload-image-to-s3";

export default function NewPlanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { id: workspaceId, slug: workspaceSlug } = useWorkspace();
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");

  const workflowIdParam = searchParams.get("workflowId");
  const workflowNameParam = searchParams.get("workflowName");
  const initialWorkflow =
    workflowIdParam && workflowNameParam
      ? {
          workflowId: parseInt(workflowIdParam, 10),
          workflowName: workflowNameParam,
          workflowRefId: "",
        }
      : undefined;

  const handleSubmit = async (
    message: string,
    options?: {
      isPrototype: boolean;
      selectedRepoId: string | null;
      selectedWorkflow?: { workflowId: number; workflowName: string; workflowRefId: string } | null;
      model?: string;
      attachmentFiles?: File[];
      selectedRepositoryIds?: string[];
    },
  ) => {
    setIsLoading(true);
    const attachmentFiles = options?.attachmentFiles ?? [];
    try {
      if (options?.isPrototype) {
        // Prototype flow: create a PROTOTYPE task and redirect to task chat
        setLoadingStatus("Creating plan…");
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

        // Upload images if attached
        let attachments: UploadedFileResult[] = [];
        if (attachmentFiles.length > 0) {
          setLoadingStatus("Uploading images…");
          const uploadResults = await Promise.allSettled(
            attachmentFiles.map((f) => uploadFileToS3(f, { taskId: task.id }))
          );
          attachments = uploadResults
            .filter((r): r is PromiseFulfilledResult<UploadedFileResult> => r.status === "fulfilled")
            .map((r) => r.value);
          uploadResults
            .filter((r) => r.status === "rejected")
            .forEach((r) => console.error("Image upload error:", (r as PromiseRejectedResult).reason));
        }

        setLoadingStatus("Sending message…");
        // Send the first message to trigger the Stakwork workflow
        const chatRes = await fetch("/api/chat/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: task.id,
            message,
            mode: "live",
            attachments,
          }),
        });

        if (!chatRes.ok) {
          console.error("Failed to send initial prototype message, but task was created");
        }

        setLoadingStatus("");
        router.push(`/w/${workspaceSlug}/task/${task.id}`);
        return;
      }

      // Standard feature creation flow
      // 1. Create Feature record
      setLoadingStatus("Creating plan…");
      const featureRes = await fetch("/api/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: message.slice(0, 100), workspaceId, model: options?.model }),
      });

      if (!featureRes.ok) {
        throw new Error("Failed to create feature");
      }

      const { data: feature } = await featureRes.json();

      // Upload images if attached
      let attachments: UploadedFileResult[] = [];
      if (attachmentFiles.length > 0) {
        setLoadingStatus("Uploading images…");
        const uploadResults = await Promise.allSettled(
          attachmentFiles.map((f) => uploadFileToS3(f, { featureId: feature.id }))
        );
        attachments = uploadResults
          .filter((r): r is PromiseFulfilledResult<UploadedFileResult> => r.status === "fulfilled")
          .map((r) => r.value);
        uploadResults
          .filter((r) => r.status === "rejected")
          .forEach((r) => console.error("Image upload error:", (r as PromiseRejectedResult).reason));
      }

      // 2. Send first chat message + trigger Stakwork workflow
      setLoadingStatus("Sending message…");
      const chatRes = await fetch(`/api/features/${feature.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, model: options?.model, attachments, selectedRepositoryIds: options?.selectedRepositoryIds }),
      });

      if (!chatRes.ok) {
        console.error("Failed to send initial message, but feature was created");
      }

      // 3. Navigate to the plan chat view
      setLoadingStatus("");
      router.push(`/w/${workspaceSlug}/plan/${feature.id}`);
    } catch (error) {
      console.error("Error creating plan:", error);
      toast.error("Failed to create plan. Please try again.");
      setIsLoading(false);
      setLoadingStatus("");
    }
  };

  return (
    <PlanStartInput
      onSubmit={handleSubmit}
      isLoading={isLoading}
      loadingStatus={loadingStatus}
      initialWorkflow={initialWorkflow}
    />
  );
}
