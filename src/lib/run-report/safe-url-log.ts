import { createHash } from "crypto";

export interface SafeUrlParts {
  host: string;
  pathHash: string;
}

/**
 * Reduce a URL to `{ host, pathHash }` for logging.
 *
 * Never log a bundle URL: the S3 object is public and unsigned, so the URL is a
 * permanent read capability over legal documents. The query string is dropped
 * unconditionally — that is where a signature or `run_token` would sit.
 */
export function safeUrlParts(raw: string): SafeUrlParts {
  try {
    const parsed = new URL(raw);
    return {
      host: parsed.hostname,
      pathHash: createHash("sha256").update(parsed.pathname).digest("hex").slice(0, 12),
    };
  } catch {
    // Never fall through to a caller logging the raw value.
    return { host: "<unparseable>", pathHash: "" };
  }
}
