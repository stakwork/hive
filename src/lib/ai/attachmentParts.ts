/**
 * Turn chat attachments into AI SDK user-message content parts.
 *
 * Client-safe (no server imports) — shared by the canvas store's
 * `toModelMessages`, the server-side history `toModelMessages`, and the
 * `/api/ask/sync` route so every path ships attachments the same way:
 *
 *   - images → `{ type: "image", image: <relative presigned path> }`
 *   - text   → `{ type: "file", data: <relative presigned path>, ... }`
 *   - other  → a text note naming the file (its bytes aren't sent)
 *
 * Both relative paths are placeholders: `resolveMessageAttachments` (server)
 * rewrites images to absolute signed URLs and inlines text files' contents.
 */

export interface AttachmentLike {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
}

export const ATTACHMENT_URL_PREFIX = "/api/upload/presigned-url";

export function attachmentUrl(path: string): string {
  return `${ATTACHMENT_URL_PREFIX}?s3Key=${encodeURIComponent(path)}`;
}

// Browsers often report an empty or generic MIME type for these (notably
// `.md`), so the extension is checked too.
const TEXT_EXTENSIONS = new Set([
  "md", "markdown", "mdx", "txt", "text", "csv", "tsv", "json", "jsonl",
  "yaml", "yml", "toml", "xml", "html", "htm", "css", "log", "ini", "env",
  "sql", "graphql", "gql", "sh", "bash", "zsh", "py", "rb", "go", "rs",
  "java", "kt", "swift", "c", "h", "cc", "cpp", "hpp", "cs", "php", "js",
  "jsx", "mjs", "cjs", "ts", "tsx", "vue", "svelte", "prisma", "proto",
  "tf", "rst", "adoc", "tex", "diff", "patch",
]);

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/x-ndjson",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/javascript",
  "application/typescript",
  "application/sql",
  "application/graphql",
  "application/x-sh",
]);

export function isImageAttachment(a: AttachmentLike): boolean {
  return a.mimeType.startsWith("image/");
}

export function isTextAttachment(a: AttachmentLike): boolean {
  if (a.mimeType.startsWith("text/") || TEXT_MIME_TYPES.has(a.mimeType)) {
    return true;
  }
  const ext = a.filename.toLowerCase().split(".").pop();
  return !!ext && ext !== a.filename.toLowerCase() && TEXT_EXTENSIONS.has(ext);
}

export type AttachmentContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string }
  | { type: "file"; data: string; mediaType: string; filename: string };

export function attachmentToPart(a: AttachmentLike): AttachmentContentPart {
  if (isImageAttachment(a)) {
    return { type: "image", image: attachmentUrl(a.path) };
  }
  if (isTextAttachment(a)) {
    return {
      type: "file",
      data: attachmentUrl(a.path),
      mediaType: a.mimeType || "text/plain",
      filename: a.filename,
    };
  }
  return {
    type: "text",
    text: `[Attached file "${a.filename}" (${a.mimeType || "unknown type"}, ${a.size} bytes) — binary content not included]`,
  };
}

/**
 * Build a user message's `content`: the plain string when there are no
 * attachments, otherwise a part array (text first, then one part per file).
 */
export function buildUserContent(
  text: string,
  attachments: AttachmentLike[] | undefined,
): string | AttachmentContentPart[] {
  if (!attachments?.length) return text;
  return [
    ...(text.trim() ? [{ type: "text" as const, text }] : []),
    ...attachments.map(attachmentToPart),
  ];
}
