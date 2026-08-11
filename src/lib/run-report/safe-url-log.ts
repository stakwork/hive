/**
 * Log-safe rendering of a URL.
 *
 * Never log a bundle URL. The report bundle is a public, unsigned S3 object, so
 * its URL is a non-expiring bearer capability over converted legal source
 * documents and agent transcripts — anything that reaches a log line, an error
 * body, or a trace grants permanent access to those documents.
 *
 * The query string is excluded unconditionally: it is where presigned
 * credentials (`X-Amz-Signature`) would live if the producer ever switches to
 * signed URLs, and it is where the `run_token` HMAC lives on webhook URLs.
 */

import { createHash } from "crypto";

export interface SafeUrlParts {
  host: string;
  /** SHA-256 of the path, first 12 hex chars. Correlates without disclosing. */
  pathHash: string;
}

/**
 * Reduce a URL to `{ host, pathHash }`. Returns `{ host: "<unparseable>" }` for
 * input that does not parse, so a malformed URL can never fall through to being
 * logged verbatim by a caller's error path.
 */
export function safeUrlParts(raw: string): SafeUrlParts {
  try {
    const parsed = new URL(raw);
    return {
      host: parsed.hostname,
      pathHash: createHash("sha256").update(parsed.pathname).digest("hex").slice(0, 12),
    };
  } catch {
    return { host: "<unparseable>", pathHash: "" };
  }
}
