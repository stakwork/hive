/**
 * Converts a string into a URL-friendly slug
 * @param input - The string to slugify
 * @returns A lowercase string with non-alphanumeric characters replaced by hyphens
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
