/**
 * URN parse/format utilities and canvas compound-id helpers.
 *
 * Canonical format:
 *   pg / canvas  →  urn:{org}:{realm}:{type}:{id}   (4 tail segments)
 *   kg           →  urn:{org}:kg:{workspace}:{type}:{id}  (5 tail segments)
 *
 * Canvas compound id: encodeRef(ref) + "." + nodeId
 *   ":"  in the canvas ref is replaced with "~" to avoid colliding with the
 *   URN colon separator.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParsedUrn =
  | { realm: "pg"; org: string; type: string; id: string }
  | { realm: "canvas"; org: string; type: string; id: string }
  | { realm: "kg"; org: string; workspace: string; type: string; id: string };

// ---------------------------------------------------------------------------
// Core parse / format
// ---------------------------------------------------------------------------

/**
 * Parse a canonical URN string into its discriminated components.
 * Returns `null` for any string that is not a valid canonical URN.
 */
export function parseUrn(s: string): ParsedUrn | null {
  if (!s.startsWith("urn:")) return null;

  const rest = s.slice(4);
  const parts = rest.split(":");

  // Minimum shape: org + realm + at least 2 tail parts
  if (parts.length < 4) return null;

  const [org, realm, ...tail] = parts;
  if (!org || !realm) return null;

  if (realm === "kg") {
    // urn:{org}:kg:{workspace}:{type}:{id}  → tail has 3 parts
    if (tail.length !== 3) return null;
    const [workspace, type, id] = tail;
    if (!workspace || !type || !id) return null;
    return { realm: "kg", org, workspace, type, id };
  }

  if (realm === "pg" || realm === "canvas") {
    // urn:{org}:{realm}:{type}:{id}  → tail has 2 parts
    if (tail.length !== 2) return null;
    const [type, id] = tail;
    if (!type || !id) return null;
    return { realm, org, type, id };
  }

  return null;
}

/**
 * Format a discriminated `ParsedUrn` back into a canonical URN string.
 */
export function formatUrn(parts: ParsedUrn): string {
  if (parts.realm === "kg") {
    return `urn:${parts.org}:kg:${parts.workspace}:${parts.type}:${parts.id}`;
  }
  return `urn:${parts.org}:${parts.realm}:${parts.type}:${parts.id}`;
}

// ---------------------------------------------------------------------------
// Canvas compound-id helpers
// ---------------------------------------------------------------------------

/**
 * Encode a canvas `ref` by replacing ":" with "~" so it can be embedded as a
 * single colon-free segment inside a URN.
 *
 * Example: "ws:clm123"  →  "ws~clm123"
 */
export function encodeCanvasRef(ref: string): string {
  return ref.replace(/:/g, "~");
}

/**
 * Decode a tilde-encoded canvas ref back to its original form.
 *
 * Example: "ws~clm123"  →  "ws:clm123"
 */
export function decodeCanvasRef(enc: string): string {
  return enc.replace(/~/g, ":");
}

/**
 * Compose the canvas compound id from a ref and a node id.
 *
 * Example: composeCanvasId("ws:clm123", "node456")  →  "ws~clm123.node456"
 */
export function composeCanvasId(ref: string, nodeId: string): string {
  return `${encodeCanvasRef(ref)}.${nodeId}`;
}

/**
 * Parse a canvas compound id back into its `ref` and `nodeId` parts.
 * Splits on the **first** "." only — node ids (nanoid/cuid) never contain ".".
 * Returns `null` if either side is empty.
 *
 * Example: "ws~clm123.node456"  →  { ref: "ws:clm123", nodeId: "node456" }
 */
export function parseCanvasId(
  id: string
): { ref: string; nodeId: string } | null {
  const dotIndex = id.indexOf(".");
  if (dotIndex === -1) return null;

  const encodedRef = id.slice(0, dotIndex);
  const nodeId = id.slice(dotIndex + 1);

  if (!encodedRef || !nodeId) return null;

  return { ref: decodeCanvasRef(encodedRef), nodeId };
}
