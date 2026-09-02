/**
 * HTML artifact tools — Jamie's Canvas Chat writer for org-scoped
 * shareable HTML pages.
 *
 * Two tools, matching the `save_research` / `update_research` UX:
 *
 *   1. `save_html`   — upload HTML to S3, create the HtmlPage pointer
 *                      row. Required: slug, title, html.
 *                      Returns `{ slug, id, sharePath }`.
 *   2. `update_html` — overwrite the same S3 key and update the row.
 *                      Required: slug, html.
 *                      Returns `{ slug, status: "updated" }`.
 *
 * Org id and user id come from the canvas-agent closure — never from
 * tool arguments. The HTML body is never stored in Postgres.
 */
import { Prisma } from "@prisma/client";
import { tool, ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  HTML_CONTENT_TYPE,
  HtmlPageKeyError,
  HtmlPageSizeError,
  isOrgOwnedS3Key,
  overwriteHtmlPageObject,
  putHtmlPageObject,
} from "@/services/html-pages";

function sharePath(githubLogin: string, slug: string): string {
  return `/org/${githubLogin}/h/${slug}`;
}

async function githubLoginForOrg(orgId: string): Promise<string | null> {
  const org = await db.sourceControlOrg.findUnique({
    where: { id: orgId },
    select: { githubLogin: true },
  });
  return org?.githubLogin ?? null;
}

function logHtmlWrite(
  action: "save_html" | "update_html",
  fields: {
    orgId: string;
    slug: string;
    s3Key?: string;
    bytes?: number;
    success: boolean;
    error?: string;
  },
): void {
  console.log(`[htmlArtifactTools] ${action}`, {
    orgId: fields.orgId,
    slug: fields.slug,
    s3Key: fields.s3Key,
    bytes: fields.bytes,
    success: fields.success,
    ...(fields.error ? { error: fields.error } : {}),
  });
}

export function buildHtmlArtifactTools(orgId: string, userId: string): ToolSet {
  return {
    save_html: tool({
      description:
        "Create a shareable HTML page artifact for this org. Call this AFTER you have researched the relevant systems and synthesized ONE HTML story (not one page per repo). " +
        "Uploads the HTML to S3 and stores a pointer (slug + s3Key) — the HTML body is not persisted in the database. " +
        "Returns `{ slug, id, sharePath }` where sharePath is the org-member URL `/org/{githubLogin}/h/{slug}`.\n\n" +
        "Required fields:\n" +
        "  - slug: short kebab-case identifier unique within the org (e.g. 'hive-vs-workspaces-story').\n" +
        "  - title: polished title shown on the preview card and share page.\n" +
        "  - html: complete HTML document (include <!DOCTYPE html> and a full document). Do not pass s3Key, orgId, or url.",
      inputSchema: z.object({
        slug: z
          .string()
          .min(1)
          .describe("Short kebab-case identifier, unique within the org."),
        title: z
          .string()
          .min(1)
          .describe("Polished title for the preview card and share page."),
        html: z
          .string()
          .min(1)
          .describe("Complete HTML document to store in S3."),
      }),
      execute: async ({
        slug,
        title,
        html,
      }: {
        slug: string;
        title: string;
        html: string;
      }) => {
        try {
          const githubLogin = await githubLoginForOrg(orgId);
          if (!githubLogin) {
            logHtmlWrite("save_html", {
              orgId,
              slug,
              success: false,
              error: "org_not_found",
            });
            return { error: "Failed to save HTML page." };
          }

          const { s3Key, size } = await putHtmlPageObject(
            orgId,
            html,
            `${slug}.html`,
          );

          const page = await db.htmlPage.create({
            data: {
              slug,
              title,
              s3Key,
              size,
              contentType: HTML_CONTENT_TYPE,
              orgId,
              createdBy: userId,
            },
            select: { id: true, slug: true },
          });

          logHtmlWrite("save_html", {
            orgId,
            slug: page.slug,
            s3Key,
            bytes: size,
            success: true,
          });

          return {
            slug: page.slug,
            id: page.id,
            sharePath: sharePath(githubLogin, page.slug),
          };
        } catch (e) {
          if (e instanceof HtmlPageSizeError) {
            logHtmlWrite("save_html", {
              orgId,
              slug,
              success: false,
              error: "oversize",
            });
            return { error: e.message };
          }
          if (e instanceof HtmlPageKeyError) {
            logHtmlWrite("save_html", {
              orgId,
              slug,
              success: false,
              error: "foreign_s3_key",
            });
            return { error: "Failed to save HTML page." };
          }
          if (
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === "P2002"
          ) {
            logHtmlWrite("save_html", {
              orgId,
              slug,
              success: false,
              error: "duplicate_slug",
            });
            return {
              error:
                "Failed to save HTML page. The slug may already be in use; try a different one.",
            };
          }
          console.error("[htmlArtifactTools] save_html failed:", e);
          logHtmlWrite("save_html", {
            orgId,
            slug,
            success: false,
            error: "unknown",
          });
          return {
            error:
              "Failed to save HTML page. The slug may already be in use; try a different one.",
          };
        }
      },
    }),

    update_html: tool({
      description:
        "Update an existing HTML page artifact. Looks up the page by slug in this org and overwrites the same S3 object (no new key). " +
        "Required: slug, html. Returns `{ slug, status: \"updated\" }`. Do not pass s3Key, orgId, or url.",
      inputSchema: z.object({
        slug: z
          .string()
          .min(1)
          .describe("The slug of the HTML page to update."),
        html: z
          .string()
          .min(1)
          .describe("Complete replacement HTML document."),
      }),
      execute: async ({ slug, html }: { slug: string; html: string }) => {
        try {
          const result = await db.$transaction(async (tx) => {
            const existing = await tx.htmlPage.findUnique({
              where: { orgId_slug: { orgId, slug } },
              select: { id: true, slug: true, s3Key: true, orgId: true },
            });
            if (!existing || existing.orgId !== orgId) {
              return { error: `No HTML page found with slug "${slug}".` } as const;
            }
            if (!isOrgOwnedS3Key(orgId, existing.s3Key)) {
              throw new HtmlPageKeyError();
            }

            const { size } = await overwriteHtmlPageObject(
              orgId,
              existing.s3Key,
              html,
            );

            await tx.htmlPage.update({
              where: { orgId_slug: { orgId, slug: existing.slug } },
              data: {
                size,
                contentType: HTML_CONTENT_TYPE,
                uploadedAt: new Date(),
              },
            });

            return {
              slug: existing.slug,
              s3Key: existing.s3Key,
              size,
              status: "updated" as const,
            };
          });

          if ("error" in result) {
            logHtmlWrite("update_html", {
              orgId,
              slug,
              success: false,
              error: "not_found",
            });
            return { error: result.error };
          }

          logHtmlWrite("update_html", {
            orgId,
            slug: result.slug,
            s3Key: result.s3Key,
            bytes: result.size,
            success: true,
          });

          return { slug: result.slug, status: "updated" as const };
        } catch (e) {
          if (e instanceof HtmlPageSizeError) {
            logHtmlWrite("update_html", {
              orgId,
              slug,
              success: false,
              error: "oversize",
            });
            return { error: e.message };
          }
          if (e instanceof HtmlPageKeyError) {
            logHtmlWrite("update_html", {
              orgId,
              slug,
              success: false,
              error: "foreign_s3_key",
            });
            return { error: "Failed to update HTML page." };
          }
          console.error("[htmlArtifactTools] update_html failed:", e);
          logHtmlWrite("update_html", {
            orgId,
            slug,
            success: false,
            error: "unknown",
          });
          return { error: "Failed to update HTML page." };
        }
      },
    }),
  };
}
