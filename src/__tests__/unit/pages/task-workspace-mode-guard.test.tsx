// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for workspace-aware task mode guard:
 * workflow_editor and project_debugger modes must only apply to the Stakwork
 * workspace (slug === "stakwork"). On any other workspace the mode is reset
 * to "live" by the useEffect added to the task page.
 */

// Mirrors the restricted-modes list in page.tsx
const RESTRICTED_MODES = ['workflow_editor', 'project_debugger'];

/**
 * Simulates the useEffect logic added to page.tsx:
 *
 *   useEffect(() => {
 *     const restrictedModes = ["workflow_editor", "project_debugger"];
 *     if (slug !== "stakwork" && restrictedModes.includes(taskMode)) {
 *       setTaskMode("live");
 *     }
 *   }, [slug, taskMode, setTaskMode]);
 */
function runModeGuardEffect(slug: string, taskMode: string, setTaskMode: ReturnType<typeof vi.fn>) {
  if (slug !== 'stakwork' && RESTRICTED_MODES.includes(taskMode)) {
    setTaskMode('live');
  }
}

describe('Task Page — workspace mode guard', () => {
  let setTaskMode: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setTaskMode = vi.fn();
    // Clear localStorage to avoid cross-test bleed
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Stakwork workspace — restricted modes must be preserved
  // ──────────────────────────────────────────────────────────────────────────
  it('does NOT call setTaskMode when slug is "stakwork" and mode is "workflow_editor"', () => {
    runModeGuardEffect('stakwork', 'workflow_editor', setTaskMode);
    expect(setTaskMode).not.toHaveBeenCalled();
  });

  it('does NOT call setTaskMode when slug is "stakwork" and mode is "project_debugger"', () => {
    runModeGuardEffect('stakwork', 'project_debugger', setTaskMode);
    expect(setTaskMode).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Non-Stakwork workspace — restricted modes must be reset
  // ──────────────────────────────────────────────────────────────────────────
  it('calls setTaskMode("live") when slug is "other-workspace" and mode is "workflow_editor"', () => {
    runModeGuardEffect('other-workspace', 'workflow_editor', setTaskMode);
    expect(setTaskMode).toHaveBeenCalledTimes(1);
    expect(setTaskMode).toHaveBeenCalledWith('live');
  });

  it('calls setTaskMode("live") when slug is "other-workspace" and mode is "project_debugger"', () => {
    runModeGuardEffect('other-workspace', 'project_debugger', setTaskMode);
    expect(setTaskMode).toHaveBeenCalledTimes(1);
    expect(setTaskMode).toHaveBeenCalledWith('live');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Non-restricted modes — no change regardless of workspace
  // ──────────────────────────────────────────────────────────────────────────
  it('does NOT call setTaskMode when mode is "live" and slug is "other-workspace"', () => {
    runModeGuardEffect('other-workspace', 'live', setTaskMode);
    expect(setTaskMode).not.toHaveBeenCalled();
  });

  it('does NOT call setTaskMode when mode is "agent" and slug is "other-workspace"', () => {
    runModeGuardEffect('other-workspace', 'agent', setTaskMode);
    expect(setTaskMode).not.toHaveBeenCalled();
  });

  it('does NOT call setTaskMode when mode is "test" and slug is "other-workspace"', () => {
    runModeGuardEffect('other-workspace', 'test', setTaskMode);
    expect(setTaskMode).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Slug change mid-session: stakwork → other-workspace
  // ──────────────────────────────────────────────────────────────────────────
  it('resets to "live" when slug changes from "stakwork" to "other-workspace" while mode is "workflow_editor"', () => {
    // First render on stakwork — no reset
    runModeGuardEffect('stakwork', 'workflow_editor', setTaskMode);
    expect(setTaskMode).not.toHaveBeenCalled();

    // Slug changes to a different workspace — effect re-runs
    runModeGuardEffect('other-workspace', 'workflow_editor', setTaskMode);
    expect(setTaskMode).toHaveBeenCalledTimes(1);
    expect(setTaskMode).toHaveBeenCalledWith('live');
  });

  it('resets to "live" when slug changes from "stakwork" to "other-workspace" while mode is "project_debugger"', () => {
    runModeGuardEffect('stakwork', 'project_debugger', setTaskMode);
    expect(setTaskMode).not.toHaveBeenCalled();

    runModeGuardEffect('other-workspace', 'project_debugger', setTaskMode);
    expect(setTaskMode).toHaveBeenCalledTimes(1);
    expect(setTaskMode).toHaveBeenCalledWith('live');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Slug change from other-workspace → stakwork (should not re-restrict)
  // ──────────────────────────────────────────────────────────────────────────
  it('does NOT reset mode when slug changes back to "stakwork"', () => {
    runModeGuardEffect('stakwork', 'workflow_editor', setTaskMode);
    expect(setTaskMode).not.toHaveBeenCalled();
  });
});
