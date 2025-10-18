import globrex from "globrex";

export function convertGlobsToRegex(globs: string): string {
  if (!globs || globs.trim() === "") {
    return "";
  }

  const globList = globs
    .split(",")
    .map((g) => g.trim())
    .filter((g) => g.length > 0);

  if (globList.length === 0) {
    return "";
  }

  const regexPatterns = globList.map((glob) => {
    const result = globrex(glob, { globstar: true });
    return result.regex.source;
  });

  if (regexPatterns.length === 1) {
    return regexPatterns[0];
  }

  return `(${regexPatterns.join("|")})`;
}
