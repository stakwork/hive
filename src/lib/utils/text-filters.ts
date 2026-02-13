/**
 * Text filtering utilities for removing base64 image data from display
 */

/**
 * Filters base64 data URIs from markdown content and replaces them with [Image] placeholders
 * 
 * @param content - The markdown content to filter
 * @returns Filtered content with base64 images replaced by [Image] placeholders
 * 
 * @example
 * ```typescript
 * const content = "Check this ![screenshot](data:image/png;base64,iVBORw0KG...) out!";
 * const filtered = filterBase64FromDisplay(content);
 * // Returns: "Check this ![screenshot][Image] out!"
 * ```
 */
export function filterBase64FromDisplay(content: string | null | undefined): string {
  if (!content) return '';
  
  // Regex to match markdown images with base64 data URIs
  // Pattern: ![alt text](data:image/TYPE;base64,DATA)
  const base64ImageRegex = /!\[([^\]]*)\]\(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+\)/g;
  
  // Replace base64 images with placeholder while preserving alt text
  return content.replace(base64ImageRegex, '![$1][Image]');
}

/**
 * Extracts all base64 data URIs from markdown content
 * 
 * @param content - The markdown content to extract from
 * @returns Array of base64 data URI strings found in the content
 * 
 * @example
 * ```typescript
 * const content = "![img1](data:image/png;base64,ABC) and ![img2](data:image/jpeg;base64,XYZ)";
 * const images = extractBase64Images(content);
 * // Returns: ["data:image/png;base64,ABC", "data:image/jpeg;base64,XYZ"]
 * ```
 */
export function extractBase64Images(content: string | null | undefined): string[] {
  if (!content) return [];
  
  // Regex to match base64 data URIs within markdown images
  const base64ImageRegex = /!\[[^\]]*\]\((data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)\)/g;
  
  const matches: string[] = [];
  let match;
  
  while ((match = base64ImageRegex.exec(content)) !== null) {
    matches.push(match[1]);
  }
  
  return matches;
}
