import type { ModelMessage } from "ai";
import { getS3Service } from "@/services/s3";

/**
 * Resolve image parts to fetchable URLs so the LLM receives visuals.
 *
 * The client (`toModelMessages`) embeds image attachments as
 * `{ type: "image", image: "/api/upload/presigned-url?s3Key=..." }` for
 * EVERY user turn that has one — including past turns in the history. That
 * value is a *relative* URL: the AI SDK only treats a string as a fetchable
 * URL when `new URL(...)` parses it; a relative path throws and is then
 * mis-read as raw base64 → Anthropic rejects it ("invalid base64 data").
 * So we must rewrite EVERY such part across the whole message array (not
 * just the latest turn), swapping the relative path for an ABSOLUTE signed
 * S3 URL the SDK can actually download.
 *
 * Mutates `messages` in place (rewriting `content` arrays); parts whose key
 * can't be resolved are dropped rather than shipped as a bad URL. Server-
 * only (uses `getS3Service`) — do not import from client code.
 */
export async function resolveMessageImageUrls(
  messages: ModelMessage[],
): Promise<void> {
  const s3 = getS3Service();
  // Map a relative `/api/upload/presigned-url?s3Key=<key>` value to its key.
  const extractS3Key = (image: unknown): string | null => {
    if (typeof image !== "string") return null;
    if (!image.startsWith("/api/upload/presigned-url")) return null;
    try {
      // Parse against a dummy base since the value is path-only.
      const key = new URL(image, "http://x").searchParams.get("s3Key");
      return key || null;
    } catch {
      return null;
    }
  };
  // Resolve each distinct key once (a key can repeat across turns).
  const keysToResolve = new Set<string>();
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content as Array<{ type?: string; image?: unknown }>) {
      if (part?.type !== "image") continue;
      const key = extractS3Key(part.image);
      if (key) keysToResolve.add(key);
    }
  }
  if (keysToResolve.size === 0) return;

  const resolved = new Map<string, URL>();
  await Promise.all(
    [...keysToResolve].map(async (key) => {
      try {
        const url = await s3.generatePresignedDownloadUrl(key);
        resolved.set(key, new URL(url));
      } catch (err) {
        console.error(
          `[resolveMessageImageUrls] failed to resolve image attachment ${key}:`,
          err,
        );
      }
    }),
  );
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    m.content = (m.content as Array<{ type?: string; image?: unknown }>)
      .map((part) => {
        if (part?.type !== "image") return part;
        const key = extractS3Key(part.image);
        if (!key) return part;
        const url = resolved.get(key);
        // Drop parts we couldn't resolve rather than ship a bad URL.
        return url ? { ...part, image: url } : null;
      })
      .filter((p) => p !== null) as typeof m.content;
  }
}
