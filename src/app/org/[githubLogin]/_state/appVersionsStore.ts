/**
 * The VERSIONS of the strut apps open in the chat's artifact panel: which
 * version is live on the app's swarm, every version it has, and the one the
 * reader picked to look at instead. Shared by the app's frame (`AppPanel`,
 * which draws the version shown) and its bar (`AppActions`: the picker, and
 * "Make vN live" in place of the pin while an older one is shown).
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

/** What the swarm says of one app. */
export interface AppVersions {
  live: string;
  /** Newest first. */
  versions: AppVersion[];
  /** May the reader make another version live (an admin of the swarm's workspace)? */
  canSetLive: boolean;
}

/** One app on one swarm. */
export const appVersionsKey = (swarmId: string, app: string): string => `${swarmId}\u0000${app}`;

/**
 * The version the frame shows: the one the reader picked, else the live
 * one, else what the card named (before the versions are read, or when they
 * cannot be). Undefined leaves it to the swarm: its live version.
 */
export function shownVersion(read: AppVersions | undefined, viewing: string | undefined, named?: string): string | undefined {
  return viewing ?? read?.live ?? named;
}

const versionsUrl = (githubLogin: string) => `/api/orgs/${encodeURIComponent(githubLogin)}/strut/apps/versions`;

interface AppVersionsState {
  byApp: Record<string, AppVersions>;
  /** Apps whose versions could not be read: the frame goes on with what the card named. */
  failed: Record<string, true>;
  /** The version the reader picked, by app; absent follows the live one. */
  viewing: Record<string, string>;
  /** Read the app's versions from its swarm. */
  refresh: (githubLogin: string, swarmId: string, app: string) => Promise<void>;
  /** Look at `version`, or (null) follow the live one again. */
  view: (key: string, version: string | null) => void;
  /** Make `version` live for everyone; the reader then follows it. Throws with the route's reason. */
  setLive: (githubLogin: string, swarmId: string, app: string, version: string) => Promise<void>;
}

const inFlight = new Map<string, Promise<void>>();

export const useAppVersionsStore = create<AppVersionsState>()((set, get) => ({
  byApp: {},
  failed: {},
  viewing: {},

  refresh: (githubLogin, swarmId, app) => {
    const key = appVersionsKey(swarmId, app);
    const running = inFlight.get(key);
    if (running) return running;
    const query = new URLSearchParams({ swarmId, app });
    const read = (async () => {
      try {
        const res = await fetch(`${versionsUrl(githubLogin)}?${query}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as AppVersions;
        set((s) => {
          const { [key]: _failed, ...failed } = s.failed;
          return { byApp: { ...s.byApp, [key]: { live: body.live, versions: body.versions ?? [], canSetLive: body.canSetLive === true } }, failed };
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

  view: (key, version) =>
    set((s) => {
      const { [key]: _was, ...viewing } = s.viewing;
      return { viewing: version && version !== s.byApp[key]?.live ? { ...viewing, [key]: version } : viewing };
    }),

  setLive: async (githubLogin, swarmId, app, version) => {
    const res = await fetch(versionsUrl(githubLogin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ swarmId, app, version }),
    });
    const body = (await res.json().catch(() => ({}))) as { live?: string; error?: string };
    if (!res.ok || typeof body.live !== "string") throw new Error(body.error ?? `Could not make ${version} live (${res.status})`);
    const key = appVersionsKey(swarmId, app);
    const live = body.live;
    set((s) => {
      const { [key]: _was, ...viewing } = s.viewing;
      const read = s.byApp[key];
      return { viewing, byApp: read ? { ...s.byApp, [key]: { ...read, live } } : s.byApp };
    });
  },
}));
