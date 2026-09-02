import { existsSync } from "fs";
import { join } from "path";

/**
 * Where a generated, gitignored export artifact (offline CSS, the trace
 * bundle) lives at runtime.
 *
 * In development that is the source directory. In production the route is a
 * compiled chunk: `__dirname` is the chunk's directory, not the source file's,
 * so a path built from it finds nothing — but `outputFileTracingIncludes`
 * (next.config.ts) copies the artifact into the function at its
 * project-relative path, and `process.cwd()` is the project root there. The
 * root-relative path is therefore tried first; the caller's own directory is
 * the fallback for any runtime that keeps the source layout.
 *
 * Returns the first candidate that exists, or the root-relative path (for the
 * error message) when neither does.
 */
export function resolveGeneratedArtifact(
  projectRelativeDir: string,
  name: string,
  callerDir: string,
): string {
  const candidates = [join(process.cwd(), projectRelativeDir, name), join(callerDir, name)];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}
