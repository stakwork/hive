/**
 * HTML artifact tools — Jamie's Canvas Chat writer/reader for org-scoped
 * shareable HTML pages.
 *
 * Three tools, matching the `save_research` / `update_research` UX:
 *
 *   1. `save_html`   — upload HTML to S3, create the HtmlPage pointer
 *                      row. Required: slug, title, html.
 *                      Returns `{ slug, id, sharePath }`.
 *   2. `update_html` — patch an existing page in place. Accepts EITHER a
 *                      full replacement `html` OR a list of exact-match
 *                      `edits` — never both, never neither. Overwrites
 *                      the same S3 key; slug/s3Key/share URL never
 *                      change. Returns `{ slug, status: "updated",
 *                      updatedAt }`.
 *   3. `get_html`    — read the current HTML of a page (capped) so an
 *                      edit can be built from real, current text
 *                      instead of a stale guess.
 *
 * Org id and user id come from the canvas-agent closure — never from
 * tool arguments. The HTML body is never stored in Postgres, and tool
 * inputs/outputs that carry a body are redacted before persistence
 * (see `canvas-turn-persistence.ts`'s `redactHtmlToolInput` /
 * `redactHtmlToolOutput`) — this module only has to get the value
 * right, not scrub it for storage.
 */
import { Prisma } from "@prisma/client";
import { tool, ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  HTML_CONTENT_TYPE,
  HtmlPageKeyError,
  HtmlPageSizeError,
  assertHtmlSize,
  getHtmlPageBytes,
  isOrgOwnedS3Key,
  overwriteHtmlPageObject,
  putHtmlPageObject,
} from "@/services/html-pages";
import { applyExactEdits, type TextEdit } from "@/services/text-edits";
import { notifyCanvasesUpdatedByLogin, ROOT_REF } from "@/lib/canvas";

/** Cap on edits per `update_html` call — mirrors `MAX_PROMPT_EDITS`. */
export const MAX_HTML_EDITS = 50;

/**
 * Cap on what `get_html` will return. A page over this size can still
 * be patched with `edits` (which never requires a full read) or
 * replaced wholesale with `html` — a *truncated* read would let an
 * edit be built from a partial document and silently mismatch or
 * corrupt the stored page, so we refuse rather than truncate.
 */
export const GET_HTML_MAX_BYTES = 256 * 1024;

/**
 * Slug format: short kebab-case, matching what `save_html` has always
 * asked for, now actually enforced. Edits make the slug the durable
 * patch handle (it's how `update_html`/`get_html` find the page), so a
 * malformed or path-traversal-shaped slug must be rejected up front
 * rather than relying solely on `isOrgOwnedS3Key`'s post-hoc key check.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX_LENGTH = 64;

const slugSchema = z
  .string()
  .min(1)
  .max(SLUG_MAX_LENGTH)
  .regex(
    SLUG_PATTERN,
    "slug must be short kebab-case: lowercase letters, digits, and single hyphens only (e.g. 'hive-vs-workspaces-story').",
  )
  .describe("Short kebab-case identifier, unique within the org.");

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

/**
 * Fixed, non-content failure classification for logs. Never includes
 * the model-facing error string (which may embed an `snippet(oldStr)`
 * echo of page-derived text) — logs stay pointer-only: slug, byte
 * counts, and this code.
 */
type HtmlToolLogReason =
  | "org_not_found"
  | "oversize"
  | "foreign_s3_key"
  | "duplicate_slug"
  | "not_found"
  | "edit_mismatch"
  | "edit_ambiguous"
  | "concurrent_update"
  | "too_large"
  | "unknown";

function logHtmlToolCall(
  action: "save_html" | "update_html" | "get_html",
  fields: {
    orgId: string;
    slug: string;
    s3Key?: string;
    bytes?: number;
    success: boolean;
    mode?: "replace" | "edits";
    editCount?: number;
    truncated?: boolean;
    reason?: HtmlToolLogReason;
  },
): void {
  console.log(`[htmlArtifactTools] ${action}`, {
    orgId: fields.orgId,
    slug: fields.slug,
    s3Key: fields.s3Key,
    bytes: fields.bytes,
    success: fields.success,
    ...(fields.mode ? { mode: fields.mode } : {}),
    ...(fields.editCount !== undefined ? { editCount: fields.editCount } : {}),
    ...(fields.truncated !== undefined ? { truncated: fields.truncated } : {}),
    ...(fields.reason ? { reason: fields.reason } : {}),
  });
}

/**
 * Map an `applyExactEdits` failure reason to the fixed log reason —
 * keeps the log-side enum independent of the edit-core's own reason
 * type so the two modules can evolve without renaming each other's
 * public surface.
 */
function editReasonToLogReason(
  reason: "empty_edits" | "too_many_edits" | "invalid_edit" | "noop_edit" | "zero_match" | "ambiguous_match",
): HtmlToolLogReason {
  return reason === "ambiguous_match" ? "edit_ambiguous" : "edit_mismatch";
}

/** Not-found shape shared by `get_html` and the edit path — cross-org and missing-slug must be indistinguishable. */
function notFoundError(slug: string): { error: string } {
  return { error: `No HTML page found with slug "${slug}".` };
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
        slug: slugSchema,
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
            logHtmlToolCall("save_html", {
              orgId,
              slug,
              success: false,
              reason: "org_not_found",
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

          logHtmlToolCall("save_html", {
            orgId,
            slug: page.slug,
            s3Key,
            bytes: size,
            success: true,
            mode: "replace",
          });

          // Fire-and-forget: a Pusher hiccup must not fail the
          // save. Matches the research-created posture — the new
          // card appears on the root canvas live, without a reload.
          void notifyCanvasesUpdatedByLogin(
            githubLogin,
            [ROOT_REF],
            "html-created",
            { slug: page.slug, htmlPageId: page.id },
          );

          return {
            slug: page.slug,
            id: page.id,
            sharePath: sharePath(githubLogin, page.slug),
          };
        } catch (e) {
          if (e instanceof HtmlPageSizeError) {
            logHtmlToolCall("save_html", {
              orgId,
              slug,
              success: false,
              reason: "oversize",
            });
            return { error: e.message };
          }
          if (e instanceof HtmlPageKeyError) {
            logHtmlToolCall("save_html", {
              orgId,
              slug,
              success: false,
              reason: "foreign_s3_key",
            });
            return { error: "Failed to save HTML page." };
          }
          if (
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === "P2002"
          ) {
            logHtmlToolCall("save_html", {
              orgId,
              slug,
              success: false,
              reason: "duplicate_slug",
            });
            return {
              error:
                "Failed to save HTML page. The slug may already be in use; try a different one.",
            };
          }
          console.error("[htmlArtifactTools] save_html failed:", e);
          logHtmlToolCall("save_html", {
            orgId,
            slug,
            success: false,
            reason: "unknown",
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
        "Patch an existing HTML page artifact. Looks up the page by slug in this org and overwrites the same S3 object — slug, storage location, and share URL never change. " +
        "Supply EITHER `edits` (targeted find/replace — prefer this for anything short of a full rewrite) OR `html` (the complete replacement document), never both. " +
        "Use `get_html` first if you don't already have the current text to build exact `edits` from. " +
        "Returns `{ slug, status: \"updated\", updatedAt }`. Do not pass s3Key, orgId, or url.",
      inputSchema: z
        .object({
          slug: slugSchema.describe("The slug of the HTML page to update."),
          html: z
            .string()
            .min(1)
            .optional()
            .describe(
              "Complete replacement HTML document. Omit when using `edits`.",
            ),
          edits: z
            .array(
              z.object({
                oldStr: z
                  .string()
                  .min(1)
                  .describe(
                    "Exact text to find in the page's current HTML — must match verbatim, including whitespace. Read it first with get_html if unsure.",
                  ),
                newStr: z
                  .string()
                  .describe("Replacement text. Pass an empty string to delete the matched text."),
                replaceAll: z
                  .boolean()
                  .optional()
                  .describe(
                    "Replace every occurrence. Omit to require oldStr to appear exactly once.",
                  ),
              }),
            )
            .min(1)
            .max(MAX_HTML_EDITS)
            .optional()
            .describe(
              "Targeted find/replace edits, applied in order to the page's current HTML. Omit when using `html`. If an oldStr does not match, the whole update is rejected and nothing is written.",
            ),
        })
        .refine((v) => (v.html !== undefined) !== (v.edits !== undefined), {
          message: "Pass either `html` or `edits`, not both and not neither.",
        }),
      execute: async ({
        slug,
        html,
        edits,
      }: {
        slug: string;
        html?: string;
        edits?: TextEdit[];
      }) => {
        // Both/neither is already rejected by the schema `.refine`, but the
        // AI SDK's tool execution doesn't always surface refine messages as
        // cleanly as a hand-checked error — belt and suspenders.
        if ((html !== undefined) === (edits !== undefined)) {
          return {
            error:
              "Pass either `html` (full replacement) or `edits` (targeted find/replace), not both and not neither.",
          };
        }

        try {
          // Read outside any transaction: a Postgres transaction cannot roll
          // back an S3 putObject, so there is no atomicity benefit to
          // including the read, and stretching a transaction across two S3
          // round-trips risks a Prisma P2028 timeout. `getHtmlPageBytes` is
          // already org-scoped (orgId+slug) and validates the stored s3Key
          // belongs to this org.
          const existing = await getHtmlPageBytes(orgId, slug);
          if (!existing) {
            logHtmlToolCall("update_html", {
              orgId,
              slug,
              success: false,
              reason: "not_found",
            });
            return notFoundError(slug);
          }
          const { page } = existing;

          let newHtml: string;
          let mode: "replace" | "edits";
          let editCount = 0;

          if (edits) {
            mode = "edits";
            editCount = edits.length;
            const currentHtml = existing.bytes.toString("utf8");
            const applied = applyExactEdits(currentHtml, edits, {
              noun: "page",
              rereadHint: "Re-read the current page with get_html.",
              maxEdits: MAX_HTML_EDITS,
            });
            if (!applied.ok) {
              logHtmlToolCall("update_html", {
                orgId,
                slug: page.slug,
                s3Key: page.s3Key,
                success: false,
                mode,
                editCount,
                reason: editReasonToLogReason(applied.reason),
              });
              // Model-facing message only — never logged (may embed a
              // page-fragment snippet).
              return { error: applied.error };
            }
            newHtml = applied.value;
          } else {
            mode = "replace";
            newHtml = html!;
          }

          // Validate size before touching the DB half of the CAS, so a
          // too-large patch fails before any write is attempted.
          try {
            assertHtmlSize(Buffer.byteLength(newHtml, "utf8"));
          } catch (e) {
            if (e instanceof HtmlPageSizeError) {
              logHtmlToolCall("update_html", {
                orgId,
                slug: page.slug,
                s3Key: page.s3Key,
                success: false,
                mode,
                editCount,
                reason: "too_large",
              });
              return { error: e.message };
            }
            throw e;
          }

          if (!isOrgOwnedS3Key(orgId, page.s3Key)) {
            logHtmlToolCall("update_html", {
              orgId,
              slug: page.slug,
              success: false,
              mode,
              editCount,
              reason: "foreign_s3_key",
            });
            return { error: "Failed to update HTML page." };
          }

          // Compare-and-swap on `updatedAt` closes the lost-update window
          // between two concurrent edit calls: if another write landed
          // between our read and now, `updateMany`'s count is 0 and we
          // abort *before* touching S3.
          const casResult = await db.$transaction(async (tx) => {
            const updateResult = await tx.htmlPage.updateMany({
              where: { orgId, slug: page.slug, updatedAt: page.updatedAt },
              data: { uploadedAt: new Date() },
            });
            return updateResult.count;
          });

          if (casResult === 0) {
            logHtmlToolCall("update_html", {
              orgId,
              slug: page.slug,
              s3Key: page.s3Key,
              success: false,
              mode,
              editCount,
              reason: "concurrent_update",
            });
            return {
              error:
                "This page was updated by someone else since you last read it. Re-read the current page with get_html and retry.",
            };
          }

          // The S3 put runs only after the CAS has already committed the
          // "claim" on this row — never a direct s3.putObject, always
          // through overwriteHtmlPageObject so the org-key guard and
          // content-type/size enforcement stay centralized.
          const { size } = await overwriteHtmlPageObject(
            orgId,
            page.s3Key,
            newHtml,
          );

          const updated = await db.htmlPage.update({
            where: { orgId_slug: { orgId, slug: page.slug } },
            data: {
              size,
              contentType: HTML_CONTENT_TYPE,
              uploadedAt: new Date(),
            },
            select: { updatedAt: true },
          });

          logHtmlToolCall("update_html", {
            orgId,
            slug: page.slug,
            s3Key: page.s3Key,
            bytes: size,
            success: true,
            mode,
            editCount,
          });

          const githubLogin = await githubLoginForOrg(orgId);
          if (githubLogin) {
            void notifyCanvasesUpdatedByLogin(
              githubLogin,
              [ROOT_REF],
              "html-updated",
              { slug: page.slug, htmlPageId: page.id },
            );
          }

          return {
            slug: page.slug,
            status: "updated" as const,
            updatedAt: updated.updatedAt.toISOString(),
          };
        } catch (e) {
          if (e instanceof HtmlPageSizeError) {
            logHtmlToolCall("update_html", {
              orgId,
              slug,
              success: false,
              reason: "oversize",
            });
            return { error: e.message };
          }
          if (e instanceof HtmlPageKeyError) {
            logHtmlToolCall("update_html", {
              orgId,
              slug,
              success: false,
              reason: "foreign_s3_key",
            });
            return { error: "Failed to update HTML page." };
          }
          console.error("[htmlArtifactTools] update_html failed:", e);
          logHtmlToolCall("update_html", {
            orgId,
            slug,
            success: false,
            reason: "unknown",
          });
          return { error: "Failed to update HTML page." };
        }
      },
    }),

    get_html: tool({
      description:
        "Read the current HTML of an existing page in this org, by slug. Use this before building `edits` for `update_html` so oldStr matches the real, current text. " +
        `Returns { slug, html, size } — capped at ${GET_HTML_MAX_BYTES} bytes; a page over that limit returns an actionable error instead of truncated HTML (apply edits without a full read, or replace wholesale).`,
      inputSchema: z.object({
        slug: slugSchema.describe("The slug of the HTML page to read."),
      }),
      execute: async ({ slug }: { slug: string }) => {
        try {
          const existing = await getHtmlPageBytes(orgId, slug);
          if (!existing) {
            logHtmlToolCall("get_html", {
              orgId,
              slug,
              success: false,
              reason: "not_found",
            });
            return notFoundError(slug);
          }
          const { page, bytes } = existing;

          if (bytes.length > GET_HTML_MAX_BYTES) {
            logHtmlToolCall("get_html", {
              orgId,
              slug: page.slug,
              bytes: bytes.length,
              success: false,
              truncated: true,
              reason: "too_large",
            });
            return {
              error:
                `page is ${bytes.length} bytes, over the ${GET_HTML_MAX_BYTES}-byte read limit — ` +
                "apply edits without a full read, or replace wholesale with update_html's `html` field.",
            };
          }

          logHtmlToolCall("get_html", {
            orgId,
            slug: page.slug,
            bytes: bytes.length,
            success: true,
            truncated: false,
          });

          return {
            slug: page.slug,
            html: bytes.toString("utf8"),
            size: bytes.length,
          };
        } catch (e) {
          console.error("[htmlArtifactTools] get_html failed:", e);
          logHtmlToolCall("get_html", {
            orgId,
            slug,
            success: false,
            reason: "unknown",
          });
          return notFoundError(slug);
        }
      },
    }),
  };
}
