/**
 * Short-lived, per-browser switch for Jamie's concept mode (the A/B arm
 * against full mode — see `src/lib/ai/canvasMode.ts`). Toggled from the
 * agent settings cog; its value rides the FIRST send of a new chat as
 * `mode: "concept"` and is stored on that chat, which keeps it. Later turns
 * (and planner / strut wake turns) read the mode from the stored chat.
 *
 * The file and storage key keep their original names from when this was the
 * "slim prompt" switch, so a stored `true` carries over as "concept mode on".
 *
 * Kept in localStorage (not on `User`) because it's a temporary test
 * switch. Off by default; storage errors read as off.
 */
const STORAGE_KEY = "hive.jamieSlimPrompt";

export function readConceptModePreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeConceptModePreference(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(STORAGE_KEY, "true");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — the switch just won't persist */
  }
}
