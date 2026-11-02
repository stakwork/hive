import { tool, ToolSet } from "ai";
import { z } from "zod";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  type FocusCandidate,
  type FocusView,
  closeNames,
  resolveFocus,
} from "@/lib/canvas/focus-target";
import { SYSTEM_MAP_NAMESPACE } from "@/lib/system-map/domain-nodes";
import { readSystemMapNodes } from "@/lib/system-map/read-nodes";
import { getInitiativeTree, listInitiatives } from "@/services/graph/workbench";

/** The infinite canvas's "pull up X" — one line for the canvas system prompt. */
export const CANVAS_FOCUS_PROMPT_LINE =
  "\n\nTo take the user to something on the infinite canvas (\"pull up the auth component\", \"show me the repo picker feature\", " +
  "\"that failing tier\"), call `focus_canvas` with its name (pass view \"system\" for a component, district or tier on the System view, " +
  "\"plan\" for an initiative, milestone or feature on the Plan view); if it finds nothing, offer the close names it returns.\n";

const LOG_TAG = "FOCUS_CANVAS";
/** Plans read for a name, newest first: a name search is not worth reading a hundred trees. */
const MAX_INITIATIVES = 8;

const PLAN_KINDS = { HiveInitiative: "initiative", HiveMilestone: "milestone", InitiativeFeature: "feature" } as const;

/** System components and zones of one workspace, as candidates. Never throws: a failed read is no candidates. */
async function systemCandidates(slug: string, userId: string): Promise<FocusCandidate[]> {
  try {
    const ws = await db.workspace.findUnique({ where: { slug }, select: { id: true } });
    if (!ws) return [];
    const read = await readSystemMapNodes({
      slug,
      userId,
      workspaceId: ws.id,
      namespace: SYSTEM_MAP_NAMESPACE,
      types: ["SysTrustZone", "SysComponent"],
    });
    if (!read.ok) return [];
    return read.nodes.flatMap((n): FocusCandidate[] =>
      n.type === "SysComponent"
        ? [{ kind: "component", ref: n.refId, name: n.name, view: "system" }]
        : n.type === "SysTrustZone"
          ? [{ kind: "zone", ref: `zone:${n.name}`, name: n.name, view: "system" }]
          : [],
    );
  } catch (err) {
    logger.warn("focus_canvas: system read failed", LOG_TAG, { slug, error: String(err) });
    return [];
  }
}

/** The plan's initiatives, milestones and features of one workspace, as candidates. */
async function planCandidates(slug: string, userId: string): Promise<FocusCandidate[]> {
  try {
    const caller = { slug, userId };
    const list = await listInitiatives(caller, MAX_INITIATIVES);
    if (!list.ok) return [];
    const trees = await Promise.all(list.data.initiatives.map((i) => getInitiativeTree(caller, i.ref_id)));
    const out: FocusCandidate[] = list.data.initiatives.map((i) => ({
      kind: "initiative",
      ref: i.ref_id,
      name: i.name,
      view: "plan",
    }));
    for (const t of trees) {
      if (!t.ok) continue;
      for (const n of t.data.nodes) {
        const kind = PLAN_KINDS[n.type as keyof typeof PLAN_KINDS];
        const name = typeof n.properties.name === "string" ? n.properties.name : "";
        if (kind && kind !== "initiative" && name) out.push({ kind, ref: n.ref_id, name, view: "plan" });
      }
    }
    return out;
  } catch (err) {
    logger.warn("focus_canvas: plan read failed", LOG_TAG, { slug, error: String(err) });
    return [];
  }
}

/** What view shows a kind when the caller didn't say: null is "whichever the user is on". */
const defaultView = (kind: string): FocusView | null =>
  kind === "component" || kind === "zone" ? "system" : kind === "initiative" || kind === "milestone" ? "plan" : null;

export function buildCanvasFocusTools({
  userId,
  workspaceSlugs,
}: {
  userId: string;
  workspaceSlugs: string[];
}): ToolSet {
  return {
    focus_canvas: tool({
      description:
        "Fly the user's infinite canvas to a named thing: a System Map component (district), trust zone, initiative, " +
        "milestone or feature (a feature is a tier on the System view). Resolves the name (exact, then contains) and " +
        "returns `{ kind, ref, name, view }`; the canvas moves by itself. Read-only. With no match it says so and " +
        "returns close names.",
      inputSchema: z.object({
        target: z.string().min(1).describe("The name to pull up, as the user said it (\"auth\", \"repo picker\")."),
        view: z
          .enum(["plan", "system"])
          .optional()
          .describe("Which view to show it on; omit to let the canvas keep the view the user is on."),
      }),
      execute: async ({ target, view }) => {
        const lists = await Promise.all(
          workspaceSlugs.flatMap((slug) => [systemCandidates(slug, userId), planCandidates(slug, userId)]),
        );
        // The same ref can come from two workspaces: keep the first.
        const seen = new Set<string>();
        const candidates = lists.flat().filter((c) => !seen.has(c.ref) && seen.add(c.ref));
        const hit = resolveFocus(candidates, target, view);
        if (!hit) {
          const suggestions = closeNames(candidates, target);
          return {
            found: false,
            message: `Nothing on the canvas is called "${target}".${suggestions.length ? ` Close names: ${suggestions.join(", ")}.` : ""}`,
            suggestions,
          };
        }
        return { kind: hit.kind, ref: hit.ref, name: hit.name, view: view ?? defaultView(hit.kind) };
      },
    }),
  };
}
