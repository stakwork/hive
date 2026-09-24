/**
 * Links into the org strut view — `/org/<githubLogin>/strut` — which embeds
 * strut (the workflow builder the org swarm's stakgraph mcp serves at
 * `/lab`) behind a short-lived token Hive mints. Strut's own URL on the
 * swarm is never a link Hive hands out: without that token it lands on the
 * lab's auth prompt.
 *
 * Strut's deep link (its own query — `wf`, `run`, `chat`, …: a vocabulary
 * strut owns, `web/src/embed.ts`) rides on the Hive URL as ONE opaque
 * param, `?strut=<that query>`, which `StrutView` unpacks onto the frame
 * URL and keeps in sync with what strut reports. Shared by the server (a
 * card's link, built at dispatch) and the view, so the two never disagree
 * on the param.
 */

/** The one Hive param that carries strut's deep link. */
export const STRUT_DEEP_LINK_PARAM = "strut";

/** Strut's deep link to a run, as strut reads it: `wf=<workflow>&run=<id>`. */
export function strutRunDeepLink(workflow: string, strutRunId: string): string {
  return new URLSearchParams({ wf: workflow, run: strutRunId }).toString();
}

/**
 * The org strut view opened on a deep link, root-relative:
 * `/org/<githubLogin>/strut?strut=wf%3Dclip%26run%3D1`. An empty link is
 * the bare view.
 */
export function strutViewPath(githubLogin: string, deepLink = ""): string {
  const path = `/org/${encodeURIComponent(githubLogin)}/strut`;
  if (!deepLink) return path;
  return `${path}?${new URLSearchParams({ [STRUT_DEEP_LINK_PARAM]: deepLink })}`;
}
