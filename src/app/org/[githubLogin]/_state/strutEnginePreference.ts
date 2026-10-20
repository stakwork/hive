/**
 * Short-lived, per-browser opt-in to run Jamie on strut's `orchestrator`
 * workflow instead of Hive's canvas agent (`services/strut-orchestrator.ts`,
 * `docs/jamie-engine.md`). Toggled from the chat header's ⋯ menu beside the
 * Concept-tree prompt and sent with each canvas chat request as
 * `strutEngine`. Server-side turns (planner wakes, automations) never
 * carry it, so they always run on Hive.
 *
 * Kept in localStorage (not on `User` or the org) because it's an
 * experiment one person tries in one browser while the rest of the org
 * stays on Hive. Off by default; storage errors read as off.
 */
const STORAGE_KEY = "hive.jamieStrutEngine";

export function readStrutEnginePreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeStrutEnginePreference(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(STORAGE_KEY, "true");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — the switch just won't persist */
  }
}
