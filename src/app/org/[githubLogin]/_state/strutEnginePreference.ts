/**
 * Per-browser switch for running Jamie on strut's `orchestrator` workflow
 * instead of Hive's canvas agent (`services/strut-orchestrator.ts`,
 * `docs/jamie-engine.md`). On by default: strut is the flow. Turning it off
 * (the chat header's ⋯ menu, beside the Concept-tree prompt) is the escape
 * hatch back to Hive's agent. Sent with each canvas chat request as
 * `strutEngine`. Server-side turns (planner wakes, automations) never
 * carry it, so they still run on Hive.
 *
 * Kept in localStorage (not on `User` or the org). Only an explicit "false"
 * turns it off; no value, or a storage error, reads as on.
 */
const STORAGE_KEY = "hive.jamieStrutEngine";

export function readStrutEnginePreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function writeStrutEnginePreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    /* storage unavailable — the switch just won't persist */
  }
}
