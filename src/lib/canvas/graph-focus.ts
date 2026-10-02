import { bounded } from "@/lib/strut-chat-activity";
import { formatUrn } from "@/lib/urn/parse";

/** The graph node the user is looking at, as the agent is told about it. */
export interface GraphFocusHint {
  workspaceSlug: string;
  /** `urn:{org}:kg:{workspace}:{type}:{ref_id}` — what the graph tools take. */
  urn: string;
  name: string;
  type: string;
}

const MAX_ID = 200;
const MAX_NAME = 120;

/** An id that can sit in a URN segment: no colons, backticks or whitespace. */
const id = (v: unknown) => {
  const s = bounded(v, MAX_ID);
  return s && !/[\s`:]/.test(s) ? s : null;
};

/**
 * Read `graphFocus` off a chat request: well-formed strings only, the name
 * stripped of anything that could break out of the prompt line it lands in
 * (it is graph data), and only for a workspace the request is scoped to.
 */
export function parseGraphFocus(raw: unknown, allowedSlugs: readonly string[]): GraphFocusHint | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const org = id(r.org);
  const workspaceSlug = id(r.workspaceSlug);
  const refId = id(r.refId);
  const type = id(r.type);
  if (!org || !workspaceSlug || !refId || !type || !allowedSlugs.includes(workspaceSlug)) return undefined;
  const name =
    typeof r.name === "string"
      ? r.name
          .replace(/[`*_\n\r]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, MAX_NAME) || refId
      : refId;
  return {
    workspaceSlug,
    urn: formatUrn({ realm: "kg", org, workspace: workspaceSlug, type, id: refId }),
    name,
    type,
  };
}
