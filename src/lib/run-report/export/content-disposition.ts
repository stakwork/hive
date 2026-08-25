/**
 * Builds a `Content-Disposition: attachment` header value that is:
 *   1. Free of CR/LF (no HTTP response splitting).
 *   2. RFC 5987-extended for non-ASCII filenames (filename*=UTF-8''...).
 *   3. Always accompanied by an ASCII fallback (filename="...").
 *
 * Shape follows the pattern established in
 * `src/app/api/admin/scorer/sessions/[id]/route.ts` and extends it with
 * RFC 5987 encoding so browsers display the real title even when it contains
 * characters outside US-ASCII.
 *
 * @param rawTitle     The human-readable title (may be non-ASCII, may contain
 *                     hostile characters — will be sanitized).
 * @param fallbackSlug ASCII-safe identifier used when rawTitle is unusable
 *                     (e.g. the run id or a fixed slug). Must be ASCII; any
 *                     non-ASCII characters are stripped before use.
 */
export function buildContentDisposition(
  rawTitle: string,
  fallbackSlug: string,
): string {
  // ── Sanitize rawTitle ──────────────────────────────────────────────────────
  // Strip any character that could cause header injection or break quoted-string
  // parsing. The strippable set includes:
  //   - CR (\r, \x0D) and LF (\n, \x0A) — header injection
  //   - double-quote (") — breaks the quoted-string value
  //   - all C0 control chars (U+0000–U+001F) and DEL (U+007F)
  //   - C1 control chars (U+0080–U+009F) — deprecated but risky in some parsers
  const sanitized = rawTitle
    .replace(/[\r\n"]/g, "")
    .replace(/[\x00-\x1F\x7F\x80-\x9F]/g, "")
    .trim();

  // ── ASCII fallback filename ────────────────────────────────────────────────
  // Derived from fallbackSlug, which callers should already make ASCII-safe
  // (run id, fixed slug). Strip any residual non-ASCII and control chars so
  // the quoted-string value is always valid in isolation.
  const asciiFallback = fallbackSlug
    .replace(/[\r\n"]/g, "")
    .replace(/[^\x20-\x7E]/g, "") // keep only printable ASCII
    .trim() || "report";

  // ── RFC 5987 encoded segment ───────────────────────────────────────────────
  // Use the sanitized title when non-empty, otherwise fall back to the ASCII
  // slug. The result is percent-encoded per RFC 5987 §3.2.1:
  //   attr-char = ALPHA / DIGIT / "!" / "#" / "$" / "&" / "+" / "-" / "." /
  //               "^" / "_" / "`" / "|" / "~"
  // Everything else is percent-encoded with %XX in uppercase hex.
  const displayName = sanitized || asciiFallback;
  const encoded = rfc5987Encode(displayName);

  // ── Assemble ───────────────────────────────────────────────────────────────
  // Two-part value as recommended by RFC 6266:
  //   filename="<ascii>" is the legacy fallback for older parsers.
  //   filename*=UTF-8''<encoded> takes precedence in RFC 5987-aware browsers.
  //
  // The final value must fit on a single line (no CR/LF). The sanitization
  // steps above guarantee this for both segments.
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Percent-encode a string per RFC 5987 §3.2.1.
 *
 * Characters in the `attr-char` set are emitted as-is; everything else is
 * UTF-8 encoded and then percent-encoded with uppercase hex digits.
 */
function rfc5987Encode(value: string): string {
  // `encodeURIComponent` encodes everything except: A-Z a-z 0-9 - _ . ! ~ * ' ( )
  // RFC 5987 attr-chars additionally permit: ! # $ & + - . ^ _ ` | ~
  // We unencode the safe attr-chars that encodeURIComponent escapes unnecessarily.
  return encodeURIComponent(value).replace(
    /%[0-9A-F]{2}/g,
    (match) => {
      const byte = parseInt(match.slice(1), 16);
      // attr-char = ALPHA / DIGIT / "!" / "#" / "$" / "&" / "+" / "-" / "." /
      //             "^" / "_" / "`" / "|" / "~"
      // encodeURIComponent already leaves ALPHA, DIGIT, and - _ . ! ~ * ' ( )
      // intact, so we only need to unescape the remaining attr-chars that it
      // would percent-encode: # $ & + ^ ` |
      if (
        byte === 0x23 || // #
        byte === 0x24 || // $
        byte === 0x26 || // &
        byte === 0x2b || // +
        byte === 0x5e || // ^
        byte === 0x60 || // `
        byte === 0x7c    // |
      ) {
        return String.fromCharCode(byte);
      }
      return match; // keep percent-encoded
    },
  );
}
