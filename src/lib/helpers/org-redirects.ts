type Query = Record<string, string | string[] | undefined>;

/** Where retired org sub-pages now live. Other query params carry over. */
const TARGETS: Record<string, { path: string; set: Record<string, string> }> = {
  initiatives: { path: "", set: { view: "canvas", tab: "initiatives" } },
  schematic: { path: "", set: { view: "canvas" } },
  workspaces: { path: "/settings", set: { section: "workspaces" } },
  members: { path: "/settings", set: { section: "members" } },
};

export type RetiredOrgPage = keyof typeof TARGETS;

export function orgRedirectTarget(page: RetiredOrgPage, githubLogin: string, query: Query = {}): string {
  const { path, set } = TARGETS[page];
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (typeof v === "string") next.set(k, v);
  }
  for (const [k, v] of Object.entries(set)) next.set(k, v);
  return `/org/${githubLogin}${path}?${next.toString()}`;
}
