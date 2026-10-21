"use client";

import React, { useCallback } from "react";
import { toast } from "sonner";
import { StrutAppFrame } from "@/components/strut-app-frame";
import { STRUT_APP_DOCUMENT, encodeStrutPath } from "@/lib/strut-apps";
import { strutViewPath } from "@/lib/utils/strut-links";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { useCanvasChatStore } from "../../../_state/canvasChatStore";
import { useLatestUpdateFor } from "../../../_state/jobLiveStore";
import { useChatOrgLogin } from "../useArtifactPanel";

/** What an app's `ui/message` becomes in the chat box: the text, naming the app it is about (strut's own `appMessage`). */
export const appMessageDraft = (title: string, text: string): string => `About the app "${title}": ${text.trim()}`;

/**
 * A strut job's APP (strut plans/apps.md §6), live in the app frame. Its
 * `ui/message` goes to the conversation it sits in — into the chat box, for
 * the person to send on to the job (an app is model-written code: it never
 * speaks in the person's name by itself); a strut deep link opens in the
 * org's strut view, where the job runs. A new build the job reports for the
 * document reloads the frame.
 */
export function AppPanel({ artifact, content }: ArtifactViewerProps<"app">) {
  const githubLogin = useChatOrgLogin();
  const documentKey = `/jobs/${encodeURIComponent(content.job)}/files/${encodeStrutPath(content.path)}/${STRUT_APP_DOCUMENT}`;
  const rebuilt = useLatestUpdateFor(documentKey)?.receivedAt;
  const { title } = artifact;
  const onMessage = useCallback(
    (text: string) => {
      useCanvasChatStore.getState().appendPendingInputDraft(appMessageDraft(title, text));
      toast.info(`"${title}" wrote a message for the job — it is in the chat box to send.`);
    },
    [title],
  );
  const strutLinkHref = useCallback((deepLink: string) => strutViewPath(githubLogin, deepLink), [githubLogin]);
  return (
    <StrutAppFrame
      source={{ githubLogin, swarmId: content.swarmId, job: content.job, path: content.path }}
      title={title}
      onMessage={onMessage}
      strutLinkHref={strutLinkHref}
      reloadKey={rebuilt}
    />
  );
}
