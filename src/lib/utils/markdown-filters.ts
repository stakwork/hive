/**
 * Markdown Image Filtering Utilities
 * 
 * Provides functions to filter markdown image syntax from display text
 * while preserving it in storage, replacing images with compact placeholders.
 */

export interface ImageInfo {
  markdown: string;
  alt: string;
  url: string;
  filename: string;
}

/**
 * Extracts filename from a URL, handling S3 URLs with query parameters
 * @param url - The image URL (may include query params)
 * @returns The extracted filename or 'image' as fallback
 */
function extractFilename(url: string): string {
  // Remove query parameters (e.g., S3 presigned URL params)
  const urlWithoutQuery = url.split('?')[0];
  
  // Extract last path segment
  const pathSegments = urlWithoutQuery.split('/');
  const filename = pathSegments[pathSegments.length - 1] || 'image';
  
  return filename;
}

/**
 * Filters markdown image syntax from content and replaces with compact placeholders
 * 
 * Transforms: `![alt text](https://s3.../screenshot.png?params)`
 * Into: `[Image: screenshot.png] `
 * 
 * @param content - The markdown content to filter
 * @returns Content with image markdown replaced by placeholders
 * 
 * @example
 * const input = "Bug report:\n![Screenshot](https://s3.../bug.png)\nSee above";
 * const output = filterImagesFromDisplay(input);
 * // Returns: "Bug report:\n[Image: bug.png] \nSee above"
 */
export function filterImagesFromDisplay(content: string): string {
  if (!content) return '';
  
  // Regex matches: ![alt](url)
  // Group 1: alt text (optional)
  // Group 2: URL
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  
  return content.replace(imageRegex, (match, alt, url) => {
    const filename = extractFilename(url);
    // Return compact placeholder with space to preserve word boundaries
    return `[Image: ${filename}] `;
  });
}

/**
 * Extracts all markdown image information from content
 * 
 * @param content - The markdown content to parse
 * @returns Array of image metadata objects
 * 
 * @example
 * const images = extractImageInfo("![Alt](https://example.com/image.png)");
 * // Returns: [{ markdown: "![Alt](...)", alt: "Alt", url: "...", filename: "image.png" }]
 */
export function extractImageInfo(content: string): ImageInfo[] {
  if (!content) return [];
  
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images: ImageInfo[] = [];
  
  let match;
  while ((match = imageRegex.exec(content)) !== null) {
    const [markdown, alt, url] = match;
    const filename = extractFilename(url);
    
    images.push({
      markdown,
      alt,
      url,
      filename,
    });
  }
  
  return images;
}
