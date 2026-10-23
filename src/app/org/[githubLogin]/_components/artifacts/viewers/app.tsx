"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { StrutAppFrame } from "@/components/strut-app-frame";
import { strutViewPath } from "@/lib/utils/strut-links";
import { appVersionsKey, shownVersion, useAppVersionsStore } from "../../../_state/appVersionsStore";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { useCanvasChatStore } from "../../../_state/canvasChatStore";
import { useChatOrgLogin } from "../useArtifactPanel";

/** What an app's `ui/message` becomes in the chat box: the text, naming the app it is about (strut's own `appMessage`). */
export const appMessageDraft = (title: string, text: string): string => `About the app "${title}": ${text.trim()}`;

/**
 * A strut APP a job delivered (the builder's, by name — strut CALLBACKS.md
 * §4), live in the app frame. Its `ui/message` goes to the conversation it
 * sits in — into the chat box, for the person to send on to the job (an app
 * is model-written code: it never speaks in the person's name by itself); a
 * strut deep link opens in the org's strut view, where the job runs.
 *
 * The frame shows the app's LIVE version unless the reader picked another
 * (`appVersionsStore`, the picker in the bar). The versions are read when
 * the app is opened and again whenever a turn delivers it — a turn that
 * changed the app published a new version — so an open frame following the
 * live version reloads on the new one.
 */
export function AppPanel({ artifact, content }: ArtifactViewerProps<"app">) {
  const githubLogin = useChatOrgLogin();
  const { swarmId, app } = content;
  const key = appVersionsKey(swarmId, app);
  const read = useAppVersionsStore((s) => s.byApp[key]);
  const failed = useAppVersionsStore((s) => !!s.failed[key]);
  const viewing = useAppVersionsStore((s) => s.viewing[key]);
  const version = shownVersion(read, viewing, content.version);
  const { title } = artifact;

  // `artifact` is the newest ref of the app in the chat: a new one is a turn that delivered it.
  useEffect(() => {
    if (githubLogin) void useAppVersionsStore.getState().refresh(githubLogin, swarmId, app);
  }, [artifact, githubLogin, swarmId, app]);

  // Following the live version, a new one replaces the frame: say so.
  const lastLive = useRef(read?.live);
  useEffect(() => {
    const live = read?.live;
    if (live && lastLive.current && live !== lastLive.current && !viewing) toast.info(`"${title}" is now ${live}`);
    lastLive.current = live;
  }, [read?.live, viewing, title]);

  const onMessage = useCallback(
    (text: string) => {
      useCanvasChatStore.getState().appendPendingInputDraft(appMessageDraft(title, text));
      toast.info(`"${title}" wrote a message for the job — it is in the chat box to send.`);
    },
    [title],
  );
  const strutLinkHref = useCallback((deepLink: string) => strutViewPath(githubLogin, deepLink), [githubLogin]);

  // One load, at the version it will stay on: wait for the versions (or for them to fail).
  if (!read && !failed) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading app" />
      </div>
    );
  }
  return (
    <StrutAppFrame
      source={{ githubLogin, swarmId, app, ...(version ? { version } : {}) }}
      title={title}
      onMessage={onMessage}
      strutLinkHref={strutLinkHref}
    />
  );
}
