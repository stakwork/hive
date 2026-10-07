/**
 * Short-lived, per-browser opt-in for the slim canvas-agent prompt
 * (concept-tree mode). Toggled from the agent settings cog and sent with
 * each canvas chat request as `slimPrompt`. Planner wake turns run
 * server-side without this flag, so they always get the full prompt.
 *
 * Kept in localStorage (not on `User`) because it's a temporary test
 * switch. Off by default; storage errors read as off.
 */
const STORAGE_KEY = "hive.jamieSlimPrompt";

export function readSlimPromptPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeSlimPromptPreference(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(STORAGE_KEY, "true");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — the switch just won't persist */
  }
}
