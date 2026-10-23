/**
 * A message's files for a strut launch (`POST …/run { attachments }`,
 * strut `src/ai/attachments.ts`): each `StoredAttachment` read from S3 —
 * only when the person can read its key, the rule of
 * `GET /api/upload/presigned-url` — and sent as `{ name, mediaType, data }`
 * with `data` base64. Strut saves them as the run's files and puts them on
 * its agents' prompts: an image or a PDF as a file the model sees, text and
 * Word documents inline.
 *
 * Strut refuses the WHOLE launch when a file is over its caps, so a file
 * past one is left out here and named in `skipped`, for the caller to tell
 * the agent (`skippedAttachmentsNote`) instead of losing the turn.
 */

import { canReadKey } from "@/lib/ai/resolveMessageAttachments";
import type { StoredAttachment } from "@/services/canvas-turn-persistence";
import { getS3Service } from "@/services/s3";

export interface StrutAttachment {
  name: string;
  mediaType: string;
  /** base64 */
  data: string;
}

export interface SkippedAttachment {
  name: string;
  reason: string;
}

const MB = 1024 * 1024;
/** Strut's caps (`src/ai/attachments.ts`): files per message, one file, one image, all together. */
export const STRUT_MAX_ATTACHMENTS = 10;
export const STRUT_MAX_ATTACHMENT_BYTES = 10 * MB;
export const STRUT_MAX_IMAGE_BYTES = 5 * MB;
export const STRUT_MAX_ATTACHMENTS_TOTAL_BYTES = 15 * MB;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Strut judges an image by its type, else its extension (a browser may send no type). */
function isImage(file: StoredAttachment): boolean {
  return IMAGE_TYPES.has(file.mimeType) || /\.(png|jpe?g|gif|webp)$/i.test(file.filename);
}

const megabytes = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;

async function read(file: StoredAttachment, userId: string): Promise<Buffer | null> {
  try {
    if (!(await canReadKey(file.path, userId))) return null;
    return await getS3Service().getObject(file.path);
  } catch {
    return null;
  }
}

/** The files strut takes, in the order attached, and the ones left out with why. */
export async function strutAttachments(
  userId: string,
  files: StoredAttachment[],
): Promise<{ attachments: StrutAttachment[]; skipped: SkippedAttachment[] }> {
  const attachments: StrutAttachment[] = [];
  const skipped: SkippedAttachment[] = [];
  const contents = await Promise.all(files.slice(0, STRUT_MAX_ATTACHMENTS).map((file) => read(file, userId)));
  let total = 0;
  files.forEach((file, i) => {
    const name = file.filename;
    if (i >= STRUT_MAX_ATTACHMENTS) {
      skipped.push({ name, reason: `more than ${STRUT_MAX_ATTACHMENTS} files in one message` });
      return;
    }
    const bytes = contents[i];
    if (!bytes) {
      skipped.push({ name, reason: "it could not be read" });
      return;
    }
    const image = isImage(file);
    const cap = image ? STRUT_MAX_IMAGE_BYTES : STRUT_MAX_ATTACHMENT_BYTES;
    if (bytes.length > cap) {
      skipped.push({ name, reason: `${megabytes(bytes.length)}, over the ${megabytes(cap)} limit for one ${image ? "image" : "file"}` });
      return;
    }
    if (total + bytes.length > STRUT_MAX_ATTACHMENTS_TOTAL_BYTES) {
      skipped.push({ name, reason: `the message's files are over ${megabytes(STRUT_MAX_ATTACHMENTS_TOTAL_BYTES)} together` });
      return;
    }
    total += bytes.length;
    attachments.push({ name, mediaType: file.mimeType, data: bytes.toString("base64") });
  });
  return { attachments, skipped };
}

/** What the agent is told about the files it did not get, after the message; "" when none. */
export function skippedAttachmentsNote(skipped: SkippedAttachment[]): string {
  if (!skipped.length) return "";
  return `\n\n(Attached but not sent to you: ${skipped.map((s) => `${s.name} — ${s.reason}`).join("; ")}.)`;
}
