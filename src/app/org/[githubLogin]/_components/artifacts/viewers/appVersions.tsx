"use client";

import React, { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ArrowUp, Check, ChevronDown, FastForward, Lock, RefreshCw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STRUT_APPS_CHANGED_EVENT } from "@/lib/strut-apps";
import {
  appVersionToastId,
  appVersionsKey,
  isDraftVersion,
  shownVersion,
  useAppVersionsStore,
  type AppDrift,
  type AppLiveTarget,
  type AppRelease,
} from "../../../_state/appVersionsStore";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { useChatOrgLogin } from "../useArtifactPanel";
import { AppPinAction } from "./appPin";

/** When a version was published, as the picker says it. */
const publishedAgo = (createdAt: string | undefined): string | null => {
  const at = createdAt ? new Date(createdAt) : null;
  return at && !Number.isNaN(at.getTime()) ? formatDistanceToNow(at, { addSuffix: true }) : null;
};

/** Who made a release live: hive names a member to strut `<login>-<user id>`, shown as the login. */
const releasedBy = (by: string | undefined): string | undefined => by?.replace(/-c[a-z0-9]{20,}$/, "");

/** A release as the list says it: "r2 · v7 · 2 hours ago · evan". */
export const releaseLabel = (release: AppRelease): string =>
  [release.id, release.version, publishedAgo(release.createdAt), releasedBy(release.by)].filter(Boolean).join(" · ");

/** One thing the live release locked that has moved on: "openhealth-run v14 → v17". */
export const driftLine = (drift: AppDrift): string => `${drift.name} ${drift.locked} → ${drift.current ?? "removed"}`;

/** What a release runs, for its tooltip: its workflows at the versions it locked. */
const lockedWorkflows = (release: AppRelease): string =>
  Object.entries(release.lock.workflows)
    .map(([name, version]) => `${name} ${version}`)
    .join(", ");

const NOT_ADMIN = "Only an admin of the app's workspace can change which version is live";

/**
 * The bar of an app's card: which version is shown — the live one, or the
 * draft the card names while the app is held, unless the reader picked
 * another — and beside it the pin, or, while another version is shown,
 * "Make vN live" in the pin's place. The picker's menu also says what
 * everyone sees (following latest, or held at a release) and lets an admin
 * hold the app, follow latest again, roll back to a release, or take the
 * workflows the live release locked as they are now. A strut without
 * releases shows none of that.
 */
export function AppActions(props: ArtifactViewerProps<"app">) {
  const githubLogin = useChatOrgLogin();
  const { swarmId, app, version: named } = props.content;
  const key = appVersionsKey(swarmId, app);
  const read = useAppVersionsStore((s) => s.byApp[key]);
  const viewing = useAppVersionsStore((s) => s.viewing[key]);
  const [busy, setBusy] = useState(false);
  if (!read) return <AppPinAction {...props} />;

  const shown = shownVersion(read, viewing, named) ?? read.live;
  const { view } = useAppVersionsStore.getState();
  const held = read.release !== null;
  const status = shown === read.live ? "live" : isDraftVersion(read, shown) ? "draft" : undefined;
  const behind = held ? read.behind : [];

  /** Change what everyone sees; tabs of the app read it again. */
  const change = async (target: AppLiveTarget, done: (made: { live: string; release: string | null }) => string) => {
    setBusy(true);
    try {
      const made = await useAppVersionsStore.getState().setLive(githubLogin, swarmId, app, target);
      window.dispatchEvent(new CustomEvent(STRUT_APPS_CHANGED_EVENT, { detail: { swarmId } }));
      toast.success(done(made), { id: appVersionToastId(key) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change which version is live", { id: appVersionToastId(key) });
    } finally {
      setBusy(false);
    }
  };

  const makeLive = () => change({ version: shown }, () => `${shown} is live`);
  const hold = () => change({ version: read.live }, ({ release }) => `Held at ${read.live}${release ? ` (${release})` : ""}`);
  const followLatest = () => change({ version: "latest" }, ({ live }) => `Following latest: ${live} is live`);
  const rollBack = (release: AppRelease) => change({ release: release.id }, () => `${release.id} is live: everyone sees ${release.version}`);
  const updateWorkflows = () =>
    change({ version: read.live }, ({ release }) => `${read.live} calls its workflows as they are now${release ? ` (${release})` : ""}`);

  const makeLiveTitle = !read.canSetLive
    ? NOT_ADMIN
    : read.holdable
      ? `Everyone who opens the app sees ${shown}, with its workflows as they are now`
      : `Everyone who opens the app sees ${shown}`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="text-xs tabular-nums" aria-label={`Version ${shown}${status ? `, ${status}` : ""}`}>
            {shown}
            <span className={status === "live" ? "text-muted-foreground" : "text-amber-600 dark-os:text-amber-400"}>{status ?? "not live"}</span>
            {behind.length > 0 && read.canSetLive && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <div className="max-h-56 overflow-y-auto">
            {read.versions.map(({ version, createdAt }) => (
              <DropdownMenuItem key={version} onSelect={() => view(key, version, named)} className="text-xs">
                <Check className={version === shown ? "h-3.5 w-3.5" : "invisible h-3.5 w-3.5"} aria-hidden />
                <span className="font-medium tabular-nums">{version}</span>
                {version === read.live ? (
                  <span className="text-muted-foreground">live</span>
                ) : (
                  isDraftVersion(read, version) && <span className="text-amber-600 dark-os:text-amber-400">draft</span>
                )}
                <span className="ml-auto text-muted-foreground">{publishedAgo(createdAt)}</span>
              </DropdownMenuItem>
            ))}
          </div>
          {read.holdable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {held ? `Held at ${read.release} · ${read.live}` : `Following latest · ${read.live}`}
              </DropdownMenuLabel>
              {!read.canSetLive ? (
                <p className="px-2 pb-1.5 text-xs text-muted-foreground">{NOT_ADMIN}</p>
              ) : held ? (
                <>
                  {behind.length > 0 && (
                    <DropdownMenuItem
                      className="text-xs"
                      disabled={busy}
                      onSelect={updateWorkflows}
                      title={`${read.live} stays live and calls its workflows as they are now:\n${behind.map(driftLine).join("\n")}`}
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                      Update workflows
                      <span className="ml-auto text-muted-foreground">{behind.length} moved</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="text-xs"
                    disabled={busy}
                    onSelect={followLatest}
                    title={`Every publish is live again: everyone sees the newest version${read.versions[0] ? `, ${read.versions[0].version}` : ""}`}
                  >
                    <FastForward className="h-3.5 w-3.5" aria-hidden />
                    Follow latest
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem
                  className="text-xs"
                  disabled={busy}
                  onSelect={hold}
                  title={`Everyone keeps seeing ${read.live}, with its workflows as they are now; new publishes are drafts until a person makes one live`}
                >
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                  Hold at {read.live}
                </DropdownMenuItem>
              )}
              {read.releases.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Releases</DropdownMenuLabel>
                  <div className="max-h-40 overflow-y-auto">
                    {[...read.releases].reverse().map((release) => (
                      <DropdownMenuItem
                        key={release.id}
                        className="text-xs"
                        disabled={!read.canSetLive || busy || release.id === read.release}
                        onSelect={() => rollBack(release)}
                        title={`Make ${release.id} live: everyone sees ${release.version}${lockedWorkflows(release) ? `, with ${lockedWorkflows(release)}` : ""}`}
                      >
                        <Check className={release.id === read.release ? "h-3.5 w-3.5" : "invisible h-3.5 w-3.5"} aria-hidden />
                        <span className="truncate tabular-nums">{releaseLabel(release)}</span>
                      </DropdownMenuItem>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {shown === read.live ? (
        <AppPinAction {...props} />
      ) : (
        // A disabled button takes no pointer events, so the reason rides on its wrapper.
        <span title={makeLiveTitle}>
          <Button variant="ghost" size="sm" className="text-xs" disabled={!read.canSetLive || busy} onClick={makeLive}>
            {status === "draft" ? <ArrowUp className="h-3.5 w-3.5" aria-hidden /> : <Undo2 className="h-3.5 w-3.5" aria-hidden />}
            Make {shown} live
          </Button>
        </span>
      )}
    </>
  );
}
