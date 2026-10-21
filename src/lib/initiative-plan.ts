/**
 * The plan under an initiative, as both the server read (`getInitiativeTree`)
 * and the canvas use it: its node types top down, and the stage a card shows.
 * Pure, so client components can import it.
 */

/** The planning types a person creates under an initiative (Jarvis migrations 133–135), top down. */
export const INITIATIVE_TREE_LABELS = [
  "HiveInitiative",
  "HiveMilestone",
  "Brief",
  "InitiativeFeature",
  "UserStory",
  "Requirement",
] as const;
export type InitiativeNodeType = (typeof INITIATIVE_TREE_LABELS)[number];

/**
 * What the canvas reads under an initiative: the planning types, plus a
 * feature's `HAS_ARCHITECTURE` (135), which strut writes. A feature's build
 * isn't in the plan: it's the strut jobs started on it.
 */
export const INITIATIVE_TREE_READ_LABELS = [...INITIATIVE_TREE_LABELS, "Architecture"] as const;
export type InitiativeTreeType = (typeof INITIATIVE_TREE_READ_LABELS)[number];

export interface InitiativeStage {
  milestones: number;
  features: number;
  stories: number;
  requirements: number;
  /** Requirements neither accepted nor dropped. */
  unaccepted: number;
}

export function initiativeStage(nodes: Array<{ type: string; properties: Record<string, unknown> }>): InitiativeStage {
  const count = (t: InitiativeNodeType) => nodes.filter((n) => n.type === t).length;
  return {
    milestones: count("HiveMilestone"),
    features: count("InitiativeFeature"),
    stories: count("UserStory"),
    requirements: count("Requirement"),
    unaccepted: nodes.filter(
      (n) => n.type === "Requirement" && n.properties.status !== "accepted" && n.properties.status !== "dropped",
    ).length,
  };
}

/** One line for a card: "2 milestones · 5 features · 12 requirements, 3 unaccepted". */
export function stageLine(s: InitiativeStage): string {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  const parts = [
    s.milestones && n(s.milestones, "milestone"),
    s.features && n(s.features, "feature"),
    s.requirements && n(s.requirements, "requirement") + (s.unaccepted ? `, ${s.unaccepted} unaccepted` : ""),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing planned yet";
}

/**
 * An answer's `makes` (Jarvis 135 `Option.makes`, `?string`): strut writes
 * it as JSON text, `["Repo picker","Guided setup"]`; an array is taken as
 * is. The names in it, or null when it is unset or not a list (the answer
 * then makes one thing, named after itself). An empty list makes nothing.
 */
export function makesList(raw: unknown): string[] | null {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return Array.isArray(value) ? value.filter((m): m is string => typeof m === "string" && !!m.trim()) : null;
}
