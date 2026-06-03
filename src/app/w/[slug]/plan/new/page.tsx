"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { PlanStartInput } from "./components";
import { toast } from "sonner";
import { uploadFileToS3, type UploadedFileResult } from "@/lib/upload-image-to-s3";

export default function NewPlanPage() {
  const router = useRouter();
  const { id: workspaceId, slug: workspaceSlug } = useWorkspace();
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");

  const handleSubmit = async (
    message: string,
    options?: {
      isPrototype: boolean;
      selectedRepoId: string | null;
      selectedWorkflow?: { workflowId: number; workflowName: string; workflowRefId: string } | null;
      model?: string;
      attachmentFile?: File;
    },
  ) => {
    setIsLoading(true);
    const attachmentFile = options?.attachmentFile;
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

        // Upload image if attached
        let attachments: UploadedFileResult[] = [];
        if (attachmentFile) {
          setLoadingStatus("Uploading image…");
          try {
            const result = await uploadFileToS3(attachmentFile, { taskId: task.id });
            attachments = [result];
          } catch (err) {
            console.error("Image upload error:", err);
            // Non-fatal: proceed with empty attachments
          }
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

      // Upload image if attached
      let attachments: UploadedFileResult[] = [];
      if (attachmentFile) {
        setLoadingStatus("Uploading image…");
        try {
          const result = await uploadFileToS3(attachmentFile, { featureId: feature.id });
          attachments = [result];
        } catch (err) {
          console.error("Image upload error:", err);
          // Non-fatal: proceed with empty attachments
        }
      }

      // 2. Send first chat message + trigger Stakwork workflow
      setLoadingStatus("Sending message…");
      const chatRes = await fetch(`/api/features/${feature.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, model: options?.model, attachments }),
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

  return <PlanStartInput onSubmit={handleSubmit} isLoading={isLoading} loadingStatus={loadingStatus} />;
}
