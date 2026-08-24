/**
 * Safe JSON serialization for embedding inside an inline <script> tag.
 *
 * Three characters can cause an inline-script body to be interpreted incorrectly
 * even inside a string literal:
 *   - `<`  → can form `</script>`, breaking out of the tag
 *   - U+2028 LINE SEPARATOR        → is a JS line terminator (ASI / syntax error
 *                                    inside a string literal pre-ES2019, still
 *                                    inadvisable inside a <script> block)
 *   - U+2029 PARAGRAPH SEPARATOR   → same
 *
 * JSON.stringify already escapes `"`, `\`, and control chars < U+0020.
 * This function adds the three remaining escapes so the result is safe to
 * drop verbatim into:
 *
 *   <script>window.__OFFLINE_REPORT__ = <escaped>;</script>
 *
 * Never throws — if `JSON.stringify` somehow fails (circular references,
 * BigInt, etc.) the error is re-thrown with no raw value attached.
 */
export function escapeForInlineScript(value: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch (err) {
    throw new Error(
      `escapeForInlineScript: JSON.stringify failed — ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }

  // Replace in one pass over the string rather than three:
  // '\u003c' is the JSON-safe encoding of '<'
  // '\u2028' and '\u2029' are their own Unicode escapes
  return json
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
