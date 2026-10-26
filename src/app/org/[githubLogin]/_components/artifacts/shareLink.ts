import { ARTIFACT_PARAM } from "@/hooks/useArtifactUrlParam";

/**
 * The link that opens this page with an artifact focused: the page's own
 * address (so `?view=` and the `?chat=` conversation are kept) with
 * `artifact=<identity>`, which `useArtifactUrlParam` reads on load. It
 * carries no access of its own — the page and the conversation it names
 * still check the reader's membership.
 */
export function artifactShareUrl(href: string, identity: string): string {
  const url = new URL(href);
  url.hash = "";
  url.searchParams.set(ARTIFACT_PARAM, identity);
  return url.toString();
}
