/**
 * What is on the control panel's stage. `chat` means the active Jamie
 * conversation in the canvas chat store (whichever one it is); plans
 * and tasks carry their entity id. A task opened from a plan remembers
 * the plan so the stage can offer a way back up the chain, and carries
 * its title since tasks are not list items.
 */
export type ControlPanelFocus =
  | { kind: "chat" }
  | { kind: "plan"; id: string }
  | { kind: "task"; id: string; planId?: string; title?: string };

/** The plan/task on stage as a canvas node id (`feature:<id>` / `task:<id>`), or null for a chat. */
export function focusNodeIdOf(focus: ControlPanelFocus): string | null {
  if (focus.kind === "chat") return null;
  return focus.kind === "plan" ? `feature:${focus.id}` : `task:${focus.id}`;
}
