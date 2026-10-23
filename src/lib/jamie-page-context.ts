/**
 * "Where the user is" for the Strut orchestrator: a client-published page
 * context (surface / view / tab + the breadcrumb path of `{kind, name, ref}`
 * steps), sanitised on the server and rendered as ONE line appended to
 * `context.line` after the time and the canvas line (`docs/jamie-engine.md`).
 * Names and refs only — never content. Pure: no server or client imports, so
 * the browser builds the path and the route sanitises it with the same code.
 */

export const PAGE_CONTEXT_KINDS = [
  "org",
  "workspace",
  "initiative",
  "milestone",
  "feature",
  "task",
  "plan",
  "research",
  "node",
  "canvas",
] as const;
export type PageContextKind = (typeof PAGE_CONTEXT_KINDS)[number];

export interface PageContextStep {
  kind: PageContextKind;
  name: string;
  /** An opaque ref (`ws:…`, `initiative:…`, a graph ref_id); absent for the org root. */
  ref?: string;
}

export interface PageContext {
  /** Jamie's surface: `org` (the org page and its canvas), … */
  surface: string;
  /** `chats` · `canvas` · `graph` … */
  view?: string;
  /** The canvas tab: `map` · `initiatives` · `brainstorm`. */
  tab?: string;
  /** Root → deepest; the last step is what "this" / "here" mean. */
  path: PageContextStep[];
  selected?: { ref: string; name?: string; type?: string }[];
  /** The open brainstorm question. */
  question?: { ref: string; text?: string };
}

export const MAX_PATH_STEPS = 8;
export const MAX_STEP_NAME = 80;
export const MAX_SELECTED = 5;
const MAX_REF = 200;
const MAX_LABEL = 40;

/** Free text made safe for a prompt line: no control chars, quotes, backticks or markdown emphasis; bounded. */
export function cleanPageText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const s = v
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ")
    .replace(/[`"*_#<>[\]{}\\|]/g, " ")
    .replace(/›/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** A ref that can sit between backticks: no whitespace, backticks or quotes. */
export function cleanPageRef(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_REF) return null;
  return /^[A-Za-z0-9][A-Za-z0-9:_.\-/]*$/.test(v) ? v : null;
}

const isKind = (v: unknown): v is PageContextKind => (PAGE_CONTEXT_KINDS as readonly string[]).includes(v as string);

const label = (v: unknown) => cleanPageText(v, MAX_LABEL).replace(/[^\p{L}\p{N} _.,?!'()/&:\-]/gu, "");

/** The kind a canvas ref implies (`ws:` → workspace); the client's claim is only a fallback. */
export function kindOfRef(ref: string | undefined, fallback: PageContextKind): PageContextKind {
  if (!ref) return fallback;
  if (ref.startsWith("ws:")) return "workspace";
  if (ref.startsWith("initiative:")) return "initiative";
  if (ref.startsWith("milestone:")) return "milestone";
  if (ref.startsWith("feature:")) return "feature";
  if (ref.startsWith("research:")) return "research";
  return fallback;
}

/**
 * Read a page context off a request body: shapes and strings only (the
 * route then checks the refs against the org, `verifyPageContextRefs`).
 * Returns undefined for anything that is not a usable context. Never throws.
 */
export function sanitizePageContext(raw: unknown): PageContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const surface = cleanPageText(r.surface, 20).replace(/[^A-Za-z0-9-]/g, "");
  if (!surface) return undefined;
  const rawPath = Array.isArray(r.path) ? r.path.slice(0, 64) : [];
  const path: PageContextStep[] = [];
  for (const item of rawPath) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const ref = s.ref === undefined || s.ref === null || s.ref === "" ? undefined : (cleanPageRef(s.ref) ?? null);
    if (ref === null) continue; // a malformed ref: drop the step, never keep the name alone
    const kind = kindOfRef(ref, isKind(s.kind) ? s.kind : "canvas");
    const name = cleanPageText(s.name, MAX_STEP_NAME) || (ref ?? kind);
    path.push({ kind, name, ...(ref ? { ref } : {}) });
  }
  // Long paths keep the root and the deepest steps — the last one is "here".
  const bounded =
    path.length > MAX_PATH_STEPS ? [path[0], ...path.slice(path.length - (MAX_PATH_STEPS - 1))] : path;
  const view = cleanPageText(r.view, 20).replace(/[^A-Za-z0-9-]/g, "");
  const tab = cleanPageText(r.tab, 20).replace(/[^A-Za-z0-9-]/g, "");
  const selected = (Array.isArray(r.selected) ? r.selected : [])
    .slice(0, MAX_SELECTED)
    .flatMap((x) => {
      if (!x || typeof x !== "object") return [];
      const o = x as Record<string, unknown>;
      const ref = cleanPageRef(o.ref);
      if (!ref) return [];
      const name = label(o.name);
      const type = typeof o.type === "string" && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(o.type) ? o.type : "";
      return [{ ref, ...(name ? { name } : {}), ...(type ? { type } : {}) }];
    });
  let question: PageContext["question"];
  if (r.question && typeof r.question === "object") {
    const q = r.question as Record<string, unknown>;
    const ref = cleanPageRef(q.ref);
    const text = label(q.text);
    if (ref) question = { ref, ...(text ? { text } : {}) };
  }
  if (path.length === 0 && !view && !tab) return undefined;
  return {
    surface,
    ...(view ? { view } : {}),
    ...(tab ? { tab } : {}),
    path: bounded,
    ...(selected.length ? { selected } : {}),
    ...(question ? { question } : {}),
  };
}

const KIND_WORD: Record<PageContextKind, string> = {
  org: "Org",
  workspace: "Workspace",
  initiative: "Initiative",
  milestone: "Milestone",
  feature: "Feature",
  task: "Task",
  plan: "Plan",
  research: "Research",
  node: "Node",
  canvas: "Canvas",
};

const VIEW_WORD: Record<string, string> = {
  chats: "Chats",
  canvas: "Canvas",
  graph: "Graph",
  map: "Map",
  initiatives: "Initiatives",
  brainstorm: "Brainstorm",
  desk: "Desk",
};
const word = (v: string) => VIEW_WORD[v] ?? v;

/**
 * `Where the user is: Org › Workspace "hive" › Initiative "Self-serve onboarding" (`ref`) › Feature "Guided setup" (`ref`) [view: Brainstorm]. `
 * — the last path step is what "this" and "here" mean. Empty for no context.
 */
export function pageContextLine(ctx: PageContext | undefined): string {
  if (!ctx) return "";
  const steps = ctx.path.map((s) =>
    s.kind === "org" && !s.ref ? KIND_WORD.org : `${KIND_WORD[s.kind]} "${s.name}"${s.ref ? ` (\`${s.ref}\`)` : ""}`,
  );
  if (steps.length === 0 || ctx.path[0].kind !== "org") steps.unshift(KIND_WORD.org);
  const tags: string[] = [];
  const viewBits = [ctx.view && word(ctx.view), ctx.tab && word(ctx.tab)].filter(Boolean);
  if (viewBits.length) tags.push(`view: ${viewBits.join(" / ")}`);
  if (ctx.selected?.length)
    tags.push(
      `selected: ${ctx.selected
        .map((s) => `${s.type ? `${s.type} ` : ""}${s.name ? `"${s.name}" ` : ""}(\`${s.ref}\`)`)
        .join(", ")}`,
    );
  if (ctx.question) tags.push(`open question: ${ctx.question.text ? `"${ctx.question.text}" ` : ""}(\`${ctx.question.ref}\`)`);
  return `Where the user is: ${steps.join(" › ")}${tags.length ? ` [${tags.join("; ")}]` : ""}. `;
}

// ─── Client side: build the path from state the page already has ──────────

export interface BreadcrumbLike {
  label: string;
  ref?: string;
}

/**
 * The path from the canvas library's breadcrumb entries (root has no ref),
 * topped up with the open initiative / selected card when the trail does not
 * reach it (the Brainstorm tab's infinite canvas).
 */
export function buildPageContextPath(args: {
  orgName: string;
  entries?: BreadcrumbLike[];
  workspace?: { slug: string; name?: string; ref?: string } | null;
  initiative?: { ref: string; name: string; selectedRef?: string | null; selectedType?: string | null; selectedLabel?: string | null } | null;
}): PageContextStep[] {
  const path: PageContextStep[] = [{ kind: "org", name: args.orgName }];
  for (const e of args.entries ?? []) {
    if (!e.ref) continue; // the root entry
    path.push({ kind: kindOfRef(e.ref, "canvas"), name: e.label, ref: e.ref });
  }
  const i = args.initiative;
  if (i && !path.some((s) => s.ref === i.ref)) {
    if (args.workspace && !path.some((s) => s.kind === "workspace"))
      path.push({ kind: "workspace", name: args.workspace.name ?? args.workspace.slug, ...(args.workspace.ref ? { ref: args.workspace.ref } : {}) });
    path.push({ kind: "initiative", name: i.name, ref: i.ref });
    if (i.selectedRef && i.selectedRef !== i.ref)
      path.push({
        kind: i.selectedType === "InitiativeFeature" ? "feature" : i.selectedType === "HiveMilestone" ? "milestone" : "node",
        name: i.selectedLabel || i.selectedRef,
        ref: i.selectedRef,
      });
  }
  return path;
}
