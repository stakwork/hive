import type { NodeFull } from "@/types/stakgraph";

/**
 * Converts a request path with actual values to a pattern path with dynamic segments
 * Examples:
 *   /api/users/123 -> /api/users/[id]
 *   /posts/abc-def -> /posts/[slug]
 *   /api/workspaces/my-workspace/tasks -> /api/workspaces/[slug]/tasks
 *   /api/users/123/posts/456 -> /api/users/[id]/posts/[id]
 */
export function convertPathToPattern(requestPath: string): string[] {
  const patterns: string[] = [];
  const segments = requestPath.split("/").filter(Boolean);

  // Common dynamic segment names by position/context
  const dynamicSegmentNames = ["id", "slug", "key", "name", "uuid"];

  // Generate multiple pattern variations
  const generatePatterns = (segs: string[], index: number, current: string[]): void => {
    if (index === segs.length) {
      patterns.push("/" + current.join("/"));
      return;
    }

    const segment = segs[index];

    // Check if segment looks like a dynamic value (UUID, number, slug, etc.)
    const looksLikeDynamic =
      /^[0-9]+$/.test(segment) || // Pure number
      /^[a-f0-9-]{36}$/.test(segment) || // UUID
      /^[a-z0-9]+(-[a-z0-9]+)+$/.test(segment) || // Kebab-case (like my-workspace)
      /^cl[a-z0-9]{24}$/.test(segment) || // CUID format
      /^[a-z0-9_]{8,}$/.test(segment); // Long alphanumeric string

    if (looksLikeDynamic) {
      // Try multiple dynamic segment name variations
      for (const name of dynamicSegmentNames) {
        generatePatterns(segs, index + 1, [...current, `[${name}]`]);
      }
      // Also try with exact segment as pattern (less common but possible)
      generatePatterns(segs, index + 1, [...current, segment]);
    } else {
      // Keep static segments as-is
      generatePatterns(segs, index + 1, [...current, segment]);
    }
  };

  generatePatterns(segments, 0, []);

  // Remove duplicates and sort by specificity (fewer dynamic segments first)
  const uniquePatterns = Array.from(new Set(patterns));
  uniquePatterns.sort((a, b) => {
    const aDynamic = (a.match(/\[/g) || []).length;
    const bDynamic = (b.match(/\[/g) || []).length;
    return aDynamic - bDynamic;
  });

  return uniquePatterns;
}

/**
 * Matches a request path to an endpoint node from the graph
 * Returns the matched node or null if no match found
 *
 * Matching strategy:
 * 1. Try exact match first
 * 2. Try pattern matches (converting dynamic segments)
 * 3. Check both node.name and node.properties.path
 */
export function matchPathToEndpoint(requestPath: string, endpointNodes: NodeFull[]): NodeFull | null {
  // Normalize request path (remove trailing slash, ensure leading slash)
  const normalizedPath = requestPath.startsWith("/")
    ? requestPath.replace(/\/$/, "")
    : `/${requestPath.replace(/\/$/, "")}`;

  // Try exact match first
  for (const node of endpointNodes) {
    const nodePath = node.properties.path as string | undefined;
    const nodeName = node.properties.name as string | undefined;

    if (nodePath === normalizedPath || nodeName === normalizedPath) {
      return node;
    }
  }

  // Generate pattern variations for the request path
  const patternVariations = convertPathToPattern(normalizedPath);

  // Try pattern matches
  for (const pattern of patternVariations) {
    for (const node of endpointNodes) {
      const nodePath = node.properties.path as string | undefined;
      const nodeName = node.properties.name as string | undefined;

      if (nodePath === pattern || nodeName === pattern) {
        return node;
      }

      // Also try case-insensitive match for robustness
      if (nodePath?.toLowerCase() === pattern.toLowerCase() || nodeName?.toLowerCase() === pattern.toLowerCase()) {
        return node;
      }
    }
  }

  return null;
}
