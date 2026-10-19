"use client";

import React from "react";
import type { GraphFocus } from "../../_state/canvasChatStore";
import type { HiddenLiveEntry } from "../../connections/HiddenLivePill";
import type { GraphWorkspace } from "../GraphView";
import { MobileArtifactLayer } from "./MobileArtifacts";
import { MobileCanvasView } from "./MobileCanvasView";
import { MobileChatScreen } from "./MobileChatScreen";
import { MobileGraphView } from "./MobileGraphView";

interface MobileOrgViewProps {
  mode: "chats" | "canvas" | "graph";
  githubLogin: string;
  orgName: string | null;
  /** The chat conversation is started in the store (`OrgCanvasView` owns that lifecycle). */
  chatReady: boolean;
  workspaces: GraphWorkspace[];
  loadingWorkspaces: boolean;
  onHiddenChange: (entries: HiddenLiveEntry[]) => void;
  onGraphFocusChange: (focus: GraphFocus | null) => void;
}

/**
 * What the org page shows on a phone, in place of its resizable panels: the
 * view `?view=` names, one screen. The lifecycle (conversation, context,
 * auto-save) stays `OrgCanvasView`'s, shared with the desktop layout.
 */
export function MobileOrgView({
  mode,
  githubLogin,
  orgName,
  chatReady,
  workspaces,
  loadingWorkspaces,
  onHiddenChange,
  onGraphFocusChange,
}: MobileOrgViewProps) {
  if (mode === "canvas") {
    return <MobileCanvasView githubLogin={githubLogin} orgName={orgName} onHiddenChange={onHiddenChange} />;
  }
  if (mode === "graph") {
    return (
      <MobileGraphView
        githubLogin={githubLogin}
        workspaces={workspaces}
        loading={loadingWorkspaces}
        onFocusChange={onGraphFocusChange}
        renderChat={(onBack) => <MobileChatScreen githubLogin={githubLogin} chatReady={chatReady} onBack={onBack} />}
      />
    );
  }
  return (
    <>
      <MobileChatScreen githubLogin={githubLogin} chatReady={chatReady} />
      <MobileArtifactLayer />
    </>
  );
}
