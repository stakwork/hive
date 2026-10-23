"use client";

import React, { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Check, ChevronDown, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STRUT_APPS_CHANGED_EVENT } from "@/lib/strut-apps";
import { appVersionsKey, shownVersion, useAppVersionsStore } from "../../../_state/appVersionsStore";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { useChatOrgLogin } from "../useArtifactPanel";
import { AppPinAction } from "./appPin";

/** When a version was published, as the picker says it. */
const publishedAgo = (createdAt: string | undefined): string | null => {
  const at = createdAt ? new Date(createdAt) : null;
  return at && !Number.isNaN(at.getTime()) ? formatDistanceToNow(at, { addSuffix: true }) : null;
};

/**
 * The bar of an app's card: which version is shown — the live one unless
 * the reader picked another — and beside it the pin, or, while an older
 * version is shown, "Make vN live" in the pin's place.
 */
export function AppActions(props: ArtifactViewerProps<"app">) {
  const githubLogin = useChatOrgLogin();
  const { swarmId, app } = props.content;
  const key = appVersionsKey(swarmId, app);
  const read = useAppVersionsStore((s) => s.byApp[key]);
  const viewing = useAppVersionsStore((s) => s.viewing[key]);
  const [busy, setBusy] = useState(false);
  if (!read) return <AppPinAction {...props} />;

  const shown = shownVersion(read, viewing) ?? read.live;
  const { view } = useAppVersionsStore.getState();

  const makeLive = async () => {
    setBusy(true);
    try {
      await useAppVersionsStore.getState().setLive(githubLogin, swarmId, app, shown);
      // A tab of the app shows the live version too: let it read again.
      window.dispatchEvent(new CustomEvent(STRUT_APPS_CHANGED_EVENT, { detail: { swarmId } }));
      toast.success(`${shown} is live`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not make ${shown} live`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="text-xs tabular-nums" aria-label={`Version ${shown}${shown === read.live ? ", live" : ""}`}>
            {shown}
            <span className={shown === read.live ? "text-muted-foreground" : "text-amber-600 dark-os:text-amber-400"}>
              {shown === read.live ? "live" : "not live"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
          {read.versions.map(({ version, createdAt }) => (
            <DropdownMenuItem key={version} onSelect={() => view(key, version)} className="text-xs">
              <Check className={version === shown ? "h-3.5 w-3.5" : "invisible h-3.5 w-3.5"} aria-hidden />
              <span className="font-medium tabular-nums">{version}</span>
              {version === read.live && <span className="text-muted-foreground">live</span>}
              <span className="ml-auto text-muted-foreground">{publishedAgo(createdAt)}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {shown === read.live ? (
        <AppPinAction {...props} />
      ) : (
        // A disabled button takes no pointer events, so the reason rides on its wrapper.
        <span title={read.canSetLive ? `Everyone who opens the app sees ${shown}` : "Only an admin of the app's workspace can change which version is live"}>
          <Button variant="ghost" size="sm" className="text-xs" disabled={!read.canSetLive || busy} onClick={makeLive}>
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
            Make {shown} live
          </Button>
        </span>
      )}
    </>
  );
}
