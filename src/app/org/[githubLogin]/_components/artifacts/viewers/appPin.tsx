"use client";

import React, { useEffect, useState } from "react";
import { Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { STRUT_APPS_CHANGED_EVENT } from "@/lib/strut-apps";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { useChatOrgLogin } from "../useArtifactPanel";

/** What the pin route says of one app on one swarm. */
interface PinState {
  pinned: boolean;
  workspace: { slug: string; name: string };
  canPin: boolean;
}

/** The button's label: the tab appears in the workspace the app's SWARM is, named here because it may not be the one in view. */
export const pinLabel = (pinned: boolean, workspace: string): string =>
  pinned ? `Pinned in ${workspace} · Unpin` : `Pin as a tab in ${workspace}`;

/**
 * "Pin as a tab in <workspace>" on an app's card: the app becomes a tab of
 * the workspace whose swarm holds it (strut's `pinned` flag, read by that
 * workspace's sidebar). Keyed by the swarm, never the workspace in view: an
 * app built on a peer is a tab of the peer's workspace. Only its admins may
 * pin; anyone else sees why. Nothing shows until the state is read, or when
 * it cannot be.
 */
export function AppPinAction({ content }: ArtifactViewerProps<"app">) {
  const githubLogin = useChatOrgLogin();
  const { swarmId, app } = content;
  const [state, setState] = useState<PinState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!githubLogin) return;
    let cancelled = false;
    setState(null);
    const query = new URLSearchParams({ swarmId, app });
    fetch(`/api/orgs/${encodeURIComponent(githubLogin)}/strut/apps/pin?${query}`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as PinState) : null))
      .then((next) => !cancelled && setState(next))
      .catch(() => !cancelled && setState(null));
    return () => {
      cancelled = true;
    };
  }, [githubLogin, swarmId, app]);

  if (!state) return null;
  const { pinned, workspace, canPin } = state;

  const toggle = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/orgs/${encodeURIComponent(githubLogin)}/strut/apps/pin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ swarmId, app, pinned: !pinned }),
      });
      const body = (await res.json().catch(() => ({}))) as { pinned?: boolean; error?: string };
      if (!res.ok || typeof body.pinned !== "boolean") throw new Error(body.error ?? `Could not change the tab (${res.status})`);
      setState({ ...state, pinned: body.pinned });
      window.dispatchEvent(new CustomEvent(STRUT_APPS_CHANGED_EVENT, { detail: { swarmId } }));
      toast.success(body.pinned ? `Pinned as a tab in ${workspace.name}` : `Unpinned from ${workspace.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the tab");
    } finally {
      setBusy(false);
    }
  };

  const Icon = pinned ? PinOff : Pin;
  // A disabled button takes no pointer events, so the reason rides on its wrapper.
  return (
    <span title={canPin ? undefined : `Only an admin of ${workspace.name} can pin its tabs`}>
      <Button variant="ghost" size="sm" className="max-w-64 text-xs" disabled={!canPin || busy} onClick={toggle}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        <span className="truncate">{pinLabel(pinned, workspace.name)}</span>
      </Button>
    </span>
  );
}
