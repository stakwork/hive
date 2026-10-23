/**
 * The VERSIONS of the strut apps open in the chat's artifact panel: which
 * version is live on the app's swarm, every version it has, the one the
 * reader picked to look at instead, and the app's RELEASES (strut
 * `plans/app-releases.md`). Shared by the app's frame (`AppPanel`, which
 * draws the version shown) and its bar (`AppActions`: the picker, holding
 * the app, and "Make vN live" in place of the pin while another is shown).
 *
 * An app FOLLOWS LATEST (every publish is live) or is HELD at a release: a
 * version a person made live, with a lock on the workflows it calls. While
 * held, a publish is a DRAFT nobody sees until a person makes it live; a
 * card the builder delivered names its draft, and the frame shows it.
 *
 * Read when the app is opened, and again whenever a turn delivers the app
 * (a builder turn that changed it published a new version): an open frame
 * following the live version then shows the new one. In memory only — the
 * swarm is the record.
 */
import { create } from "zustand";

/** One published version of an app, as `…/strut/apps/versions` lists it. */
export interface AppVersion {
  version: string;
  createdAt?: string;
}

/** A version a person made live, with the labels of what it calls as they were then. */
export interface AppRelease {
  /** `r1`, `r2`, … */
  id: string;
  version: string;
  createdAt?: string;
  by?: string;
  lock: { workflows: Record<string, string>; steps: Record<string, string>; floating: string[] };
}

/** A workflow or step the live release locked that has moved on since (`current: null`: gone). */
export interface AppDrift {
  kind: "workflow" | "step";
  name: string;
  locked: string;
  current: string | null;
}

/** What the swarm says of one app. */
export interface AppVersions {
  live: string;
  /** Newest first. */
  versions: AppVersion[];
  /** May the reader change what is live (an admin of the swarm's workspace)? */
  canSetLive: boolean;
  /** The swarm's strut has releases: the app can be held. False on an older strut, which shows no hold. */
  holdable: boolean;
  /** The live release's id; null while the app follows latest. */
  release: string | null;
  /** Oldest first. */
  releases: AppRelease[];
  /** What the live release's lock names that has moved on since. */
  behind: AppDrift[];
}

/** What a person can make live: a version (`latest` follows latest again), or a release. */
export type AppLiveTarget = { version: string } | { release: string };

/** One app on one swarm. */
export const appVersionsKey = (swarmId: string, app: string): string => `${swarmId}\u0000${app}`;

/** The id of an app's version toasts: the bar's says what it did over the frame's. */
export const appVersionToastId = (key: string): string => `app-versions:${key}`;

const versionNumber = (label: string): number => Number(label.slice(1));

/** Newer than the live version, and never made live (no release names it). */
const unreleasedAfterLive = (read: AppVersions, version: string): boolean =>
  versionNumber(version) > versionNumber(read.live) && !read.releases.some((r) => r.version === version);

/** A DRAFT: published while the app is held, newer than the live version, never made live. */
export const isDraftVersion = (read: AppVersions, version: string): boolean => read.release !== null && unreleasedAfterLive(read, version);

/**
 * The version the frame shows: the one the reader picked; else what the
 * card named when it is newer than the live one and was never live (a
 * draft the builder delivered, or a publish the read has not caught up
 * with); else the live one; else what the card named (before the versions
 * are read, or when they cannot be). Undefined leaves it to the swarm: its
 * live version.
 */
export function shownVersion(read: AppVersions | undefined, viewing: string | undefined, named?: string): string | undefined {
  if (viewing) return viewing;
  if (read && named && unreleasedAfterLive(read, named)) return named;
  return read?.live ?? named;
}

const versionsUrl = (githubLogin: string) => `/api/orgs/${encodeURIComponent(githubLogin)}/strut/apps/versions`;

/** The route's answer, read as the store keeps it; a strut without releases leaves the release fields out. */
function readVersions(body: Partial<AppVersions>): AppVersions {
  return {
    live: body.live ?? "",
    versions: body.versions ?? [],
    canSetLive: body.canSetLive === true,
    holdable: body.holdable === true,
    release: body.release ?? null,
    releases: body.releases ?? [],
    behind: body.behind ?? [],
  };
}

interface AppVersionsState {
  byApp: Record<string, AppVersions>;
  /** Apps whose versions could not be read: the frame goes on with what the card named. */
  failed: Record<string, true>;
  /** The version the reader picked, by app; absent shows what `shownVersion` picks. */
  viewing: Record<string, string>;
  /** Read the app's versions from its swarm. `fresh`: after a write, never answered by a read already running. */
  refresh: (githubLogin: string, swarmId: string, app: string, opts?: { fresh?: boolean }) => Promise<void>;
  /** Look at `version`, or (null) go back to what is shown unpicked: the card's draft, else the live one. */
  view: (key: string, version: string | null, named?: string) => void;
  /**
   * Make `target` live for everyone, then read the versions again (a promote
   * adds a release); the reader's pick is let go. Throws with the route's reason.
   */
  setLive: (githubLogin: string, swarmId: string, app: string, target: AppLiveTarget) => Promise<{ live: string; release: string | null }>;
}

const inFlight = new Map<string, Promise<void>>();

export const useAppVersionsStore = create<AppVersionsState>()((set, get) => ({
  byApp: {},
  failed: {},
  viewing: {},

  refresh: async (githubLogin, swarmId, app, opts) => {
    const key = appVersionsKey(swarmId, app);
    const running = inFlight.get(key);
    if (running && !opts?.fresh) return running;
    // A read that started before a write may answer what was live before it.
    if (running) await running;
    const query = new URLSearchParams({ swarmId, app });
    const read = (async () => {
      try {
        const res = await fetch(`${versionsUrl(githubLogin)}?${query}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = readVersions((await res.json()) as Partial<AppVersions>);
        set((s) => {
          const { [key]: _failed, ...failed } = s.failed;
          return { byApp: { ...s.byApp, [key]: body }, failed };
        });
      } catch {
        // Keep what was read before; with nothing read, the frame shows what the card named.
        if (!get().byApp[key]) set((s) => ({ failed: { ...s.failed, [key]: true } }));
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, read);
    return read;
  },

  view: (key, version, named) =>
    set((s) => {
      const { [key]: _was, ...viewing } = s.viewing;
      const unpicked = shownVersion(s.byApp[key], undefined, named);
      return { viewing: version && version !== unpicked ? { ...viewing, [key]: version } : viewing };
    }),

  setLive: async (githubLogin, swarmId, app, target) => {
    const res = await fetch(versionsUrl(githubLogin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ swarmId, app, ...target }),
    });
    const body = (await res.json().catch(() => ({}))) as { live?: string; release?: string | null; error?: string };
    const what = "release" in target ? target.release : target.version;
    if (!res.ok || typeof body.live !== "string") throw new Error(body.error ?? `Could not make ${what} live (${res.status})`);
    const key = appVersionsKey(swarmId, app);
    const live = body.live;
    const release = body.release ?? null;
    set((s) => {
      const { [key]: _was, ...viewing } = s.viewing;
      const read = s.byApp[key];
      return { viewing, byApp: read ? { ...s.byApp, [key]: { ...read, live, release } } : s.byApp };
    });
    await get().refresh(githubLogin, swarmId, app, { fresh: true });
    return { live, release };
  },
}));
