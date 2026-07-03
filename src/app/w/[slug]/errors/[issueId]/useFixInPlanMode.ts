"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { parseBlobContent } from "@/lib/utils/error-frames";
import { buildErrorPlanSeedMessage } from "@/lib/utils/error-plan-seed";
import type { ErrorIssueDetailResponse } from "@/types/error-issues";

export function useFixInPlanMode(
  detail: ErrorIssueDetailResponse | null,
  slug: string,
) {
  const [isLaunching, setIsLaunching] = useState(false);

  const launch = useCallback(async () => {
    if (!detail) return;
    setIsLaunching(true);

    const { issue, events } = detail;
    // Always derive workspaceId from the fetched issue — never accept caller-supplied value
    const workspaceId = issue.workspaceId;
    const latestEvent = events[0];

    // Step 1: best-effort fetch the latest event's blob for stack frames
    let parsedBlob: ReturnType<typeof parseBlobContent> | undefined;
    if (latestEvent) {
      try {
        const res = await fetch(
          `/api/errors/${issue.id}/events/${latestEvent.id}/blob`,
        );
        if (res.ok) {
          const text = await res.text();
          if (text) parsedBlob = parseBlobContent(text);
        }
      } catch (err) {
        console.error("[useFixInPlanMode] blob fetch failed, continuing without frames", err);
      }
    }

    // Step 2: build seed message
    const seed = buildErrorPlanSeedMessage(issue, latestEvent, parsedBlob);

    // Step 3: create Feature
    let featureId: string;
    try {
      const titleBase = issue.title || issue.exceptionType;
      const title = `Fix: ${titleBase}`.slice(0, 100);

      const featureRes = await fetch("/api/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, workspaceId }),
      });

      if (!featureRes.ok) {
        throw new Error(`Feature creation failed (${featureRes.status})`);
      }

      const { data: feature } = await featureRes.json();
      featureId = feature.id;
    } catch (err) {
      console.error("[useFixInPlanMode] feature creation failed", err);
      toast.error("Failed to create plan. Please try again.");
      setIsLaunching(false);
      return;
    }

    // Step 4: seed plan chat (include selectedRepositoryIds only when repositoryId is present)
    try {
      const body: Record<string, unknown> = { message: seed };
      if (issue.repositoryId) {
        body.selectedRepositoryIds = [issue.repositoryId];
      }

      const chatRes = await fetch(`/api/features/${featureId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!chatRes.ok) {
        throw new Error(`Chat seed failed (${chatRes.status})`);
      }
    } catch (err) {
      console.error("[useFixInPlanMode] chat seed failed", err);
      toast.error("Failed to seed plan chat. Please try again.");
      setIsLaunching(false);
      return;
    }

    // Step 5: open new plan in a new tab
    window.open(`/w/${slug}/plan/${featureId}`, "_blank", "noopener,noreferrer");
    setIsLaunching(false);
  }, [detail, slug]);

  return { launch, isLaunching };
}
