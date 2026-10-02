import type { ModelMessage } from "ai";
import { getS3Service } from "@/services/s3";
import {
  validateUserBelongsToOrg,
  validateWorkspaceAccessById,
} from "@/services/workspace";
import { extractS3KeyInfo } from "@/lib/utils/s3-key-info";
import { ATTACHMENT_URL_PREFIX } from "@/lib/ai/attachmentParts";

/** Max chars of one text attachment inlined into model context. */
const TEXT_ATTACHMENT_CHAR_CAP = 100_000;

type Part = {
  type?: string;
  image?: unknown;
  data?: unknown;
  filename?: unknown;
};

// Map a relative `/api/upload/presigned-url?s3Key=<key>` value to its key.
function extractS3Key(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith(ATTACHMENT_URL_PREFIX)) return null;
  try {
    // Parse against a dummy base since the value is path-only.
    return new URL(value, "http://x").searchParams.get("s3Key") || null;
  } catch {
    return null;
  }
}

// Same membership rule as `GET /api/upload/presigned-url`: the file's
// contents end up in the reply, so the caller must be able to read the key.
async function canReadKey(key: string, userId: string): Promise<boolean> {
  const info = extractS3KeyInfo(key);
  if (!info?.id) return false;
  if (info.type === "org") {
    return validateUserBelongsToOrg(info.id, userId, "githubLogin");
  }
  const access = await validateWorkspaceAccessById(info.id, userId);
  return access.hasAccess && access.canRead;
}

/**
 * Resolve attachment placeholder parts (see `attachmentParts.ts`) so the
 * LLM actually receives the files.
 *
 * The client embeds attachments as relative
 * `/api/upload/presigned-url?s3Key=...` values on EVERY user turn that has
 * one — including past turns in the history:
 *
 *   - image parts: the AI SDK only treats a string as a fetchable URL when
 *     `new URL(...)` parses it; a relative path throws and is then mis-read
 *     as raw base64 → Anthropic rejects it ("invalid base64 data"). Rewritten
 *     to an ABSOLUTE signed S3 URL.
 *   - file parts (text attachments: .md, .txt, .json, …): read from S3 and
 *     replaced by a text part carrying the file's contents. Requires
 *     `userId` with read access to the key's workspace/org.
 *
 * Mutates `messages` in place (rewriting `content` arrays). Parts that can't
 * be resolved are dropped (images) or replaced by a note (text) rather than
 * shipped as a bad URL. Server-only — do not import from client code.
 */
export async function resolveMessageAttachments(
  messages: ModelMessage[],
  { userId }: { userId: string | null },
): Promise<void> {
  const s3 = getS3Service();
  const imageKeys = new Set<string>();
  const textKeys = new Set<string>();
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content as Part[]) {
      if (part?.type === "image") {
        const key = extractS3Key(part.image);
        if (key) imageKeys.add(key);
      } else if (part?.type === "file") {
        const key = extractS3Key(part.data);
        if (key) textKeys.add(key);
      }
    }
  }
  if (imageKeys.size === 0 && textKeys.size === 0) return;

  // Resolve each distinct key once (a key can repeat across turns).
  const images = new Map<string, URL>();
  const texts = new Map<string, string>();
  await Promise.all([
    ...[...imageKeys].map(async (key) => {
      try {
        images.set(key, new URL(await s3.generatePresignedDownloadUrl(key)));
      } catch (err) {
        console.error(
          `[resolveMessageAttachments] failed to resolve image attachment ${key}:`,
          err,
        );
      }
    }),
    ...[...textKeys].map(async (key) => {
      try {
        if (!userId || !(await canReadKey(key, userId))) return;
        const body = (await s3.getObject(key)).toString("utf8");
        texts.set(
          key,
          body.length > TEXT_ATTACHMENT_CHAR_CAP
            ? `${body.slice(0, TEXT_ATTACHMENT_CHAR_CAP)}\n[… truncated, ${body.length - TEXT_ATTACHMENT_CHAR_CAP} more chars]`
            : body,
        );
      } catch (err) {
        console.error(
          `[resolveMessageAttachments] failed to read text attachment ${key}:`,
          err,
        );
      }
    }),
  ]);

  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    m.content = (m.content as Part[])
      .map((part) => {
        if (part?.type === "image") {
          const key = extractS3Key(part.image);
          if (!key) return part;
          const url = images.get(key);
          return url ? { ...part, image: url } : null;
        }
        if (part?.type === "file") {
          const key = extractS3Key(part.data);
          if (!key) return part;
          const filename = typeof part.filename === "string" ? part.filename : key;
          const text = texts.get(key);
          return {
            type: "text",
            text:
              text === undefined
                ? `[Attached file "${filename}" could not be read]`
                : `<attachment filename="${filename}">\n${text}\n</attachment>`,
          };
        }
        return part;
      })
      .filter((p) => p !== null) as typeof m.content;
  }
}
