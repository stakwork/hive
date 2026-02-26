/**
 * Detects if pasted text is JSON or structured code and wraps it in markdown code fences.
 * 
 * @param text - The pasted text to analyze
 * @returns The original text or wrapped version with appropriate markdown code fences
 */
export function detectAndWrapCode(text: string): string {
  // Return unchanged if empty or only whitespace
  if (!text || !text.trim()) {
    return text;
  }

  const trimmed = text.trim();

  // Single-line text with no structural characters - likely prose
  const hasNewlines = /\n/.test(trimmed);
  const hasStructuralChars = /[{}()\[\];<>]/.test(trimmed);
  
  if (!hasNewlines && !hasStructuralChars) {
    return text;
  }

  // Try parsing as JSON first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const prettified = JSON.stringify(parsed, null, 2);
      return `\`\`\`json\n${prettified}\n\`\`\``;
    } catch {
      // Not valid JSON, continue with other checks
    }
  }

  // Check if it looks like structured code
  // Must have newlines AND (indentation OR structural characters)
  const hasIndentation = /^\s+/m.test(trimmed);
  
  if (hasNewlines && (hasIndentation || hasStructuralChars)) {
    return `\`\`\`\n${text}\n\`\`\``;
  }

  // Default: return unchanged
  return text;
}
