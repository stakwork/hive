/**
 * Catalog of seeded HTML-page fixtures.
 *
 * Filenames here MUST match files in `src/lib/mock/fixtures/html/`.
 * Seeded `HtmlPage.s3Key`s use `htmlPageFixtureS3Key` so the mock S3
 * wrapper can lazily hydrate the same bytes on first access (the
 * in-memory map is process-local and a standalone seed cannot put
 * bodies where the Next server can see them).
 *
 * `shareRef` is left null on every seeded row — no public link.
 */

export const HTML_PAGE_FIXTURES = [
  {
    filename: "hive-vs-workspaces.html",
    slug: "hive-vs-workspaces",
    title: "Hive vs Workspaces",
  },
  {
    filename: "architecture-overview.html",
    slug: "architecture-overview",
    title: "Architecture Overview",
  },
  {
    filename: "onboarding-story.html",
    slug: "onboarding-story",
    title: "Onboarding Story",
  },
  {
    filename: "q4-roadmap.html",
    slug: "q4-roadmap",
    title: "Q4 Roadmap",
  },
] as const;

/** Deterministic org-owned key the mock S3 hydrates from disk. */
export function htmlPageFixtureS3Key(orgId: string, filename: string): string {
  return `orgs/${orgId}/canvas/${filename}`;
}
