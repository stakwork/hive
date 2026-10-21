import { z } from "zod";
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

/** The brainstorm board the user is on, as the agent is told about it. */
export interface BrainstormFocusHint {
  workspaceSlug: string;
  rootRefId: string;
  rootText: string;
  jobId?: string;
  selectedRefId?: string;
  selectedLabel?: string;
}

const brainstormFocusSchema = z.object({
  workspaceSlug: z.string(),
  rootRefId: z.string(),
  rootText: z.string().optional().nullable(),
  jobId: z.string().optional().nullable(),
  selectedRefId: z.string().optional().nullable(),
  selectedLabel: z.string().optional().nullable(),
});

/** Graph text stripped of anything that could break out of the prompt line it lands in. */
const promptText = (v: string | null | undefined, max: number) =>
  (v ?? "").replace(/[`*_\n\r"]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Read `brainstormFocus` off a chat request: well-formed ids only, only for
 * a workspace the request is scoped to; the texts (graph data) are stripped
 * of prompt-breaking characters.
 */
export function parseBrainstormFocus(raw: unknown, allowedSlugs: readonly string[]): BrainstormFocusHint | undefined {
  const parsed = brainstormFocusSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const r = parsed.data;
  const workspaceSlug = id(r.workspaceSlug);
  const rootRefId = id(r.rootRefId);
  if (!workspaceSlug || !rootRefId || !allowedSlugs.includes(workspaceSlug)) return undefined;
  const jobId = id(r.jobId);
  const selectedRefId = id(r.selectedRefId);
  const selectedLabel = promptText(r.selectedLabel, 40);
  return {
    workspaceSlug,
    rootRefId,
    rootText: promptText(r.rootText, MAX_NAME * 2) || rootRefId,
    ...(jobId ? { jobId } : {}),
    ...(selectedRefId ? { selectedRefId } : {}),
    ...(selectedRefId && selectedLabel ? { selectedLabel } : {}),
  };
}

/** The initiative the user is on (the infinite canvas), as the agent is told about it. */
export interface InitiativeFocusHint {
  workspaceSlug: string;
  initiativeRefId: string;
  initiativeName: string;
  /** One line from the graph, e.g. "2 milestones · 3 features · 7 requirements, 3 unaccepted". */
  stage?: string;
  selectedRefId?: string;
  /** The selected card's node type (HiveMilestone, InitiativeFeature, …). */
  selectedType?: string;
  selectedLabel?: string;
}

const initiativeFocusSchema = z.object({
  workspaceSlug: z.string(),
  initiativeRefId: z.string(),
  initiativeName: z.string().optional().nullable(),
  stage: z.string().optional().nullable(),
  selectedRefId: z.string().optional().nullable(),
  selectedType: z.string().optional().nullable(),
  selectedLabel: z.string().optional().nullable(),
});

const NODE_TYPE = /^[A-Za-z][A-Za-z0-9]{0,40}$/;

/** Read `initiativeFocus` off a chat request, by the same rules as `parseBrainstormFocus`. */
export function parseInitiativeFocus(raw: unknown, allowedSlugs: readonly string[]): InitiativeFocusHint | undefined {
  const parsed = initiativeFocusSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const r = parsed.data;
  const workspaceSlug = id(r.workspaceSlug);
  const initiativeRefId = id(r.initiativeRefId);
  if (!workspaceSlug || !initiativeRefId || !allowedSlugs.includes(workspaceSlug)) return undefined;
  const stage = promptText(r.stage, 120);
  const selectedRefId = id(r.selectedRefId);
  const selectedType = r.selectedType && NODE_TYPE.test(r.selectedType) ? r.selectedType : "";
  const selectedLabel = promptText(r.selectedLabel, MAX_NAME);
  return {
    workspaceSlug,
    initiativeRefId,
    initiativeName: promptText(r.initiativeName, MAX_NAME * 2) || initiativeRefId,
    ...(stage ? { stage } : {}),
    ...(selectedRefId ? { selectedRefId } : {}),
    ...(selectedRefId && selectedType ? { selectedType } : {}),
    ...(selectedRefId && selectedLabel ? { selectedLabel } : {}),
  };
}
