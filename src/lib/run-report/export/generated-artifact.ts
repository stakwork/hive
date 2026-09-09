import { existsSync } from "fs";

/**
 * Picks where a generated, gitignored export artifact (offline CSS, the
 * trace bundle) lives at runtime.
 *
 * In development that is the source directory. In production the route is a
 * compiled chunk: `__dirname` is the chunk's directory, not the source
 * file's, so a path built from it finds nothing — but output file tracing
 * (next.config.ts `outputFileTracingIncludes`) copies the artifact into the
 * function at its project-relative path, and `process.cwd()` is the project
 * root there.
 *
 * Callers MUST build each candidate from string literals at the call site,
 * e.g. `join(process.cwd(), "src/lib/x/export/file.css")`. Next's file
 * tracer evaluates `process.cwd()` and `__dirname` statically; a join with
 * a non-literal segment is treated as a partially-known path and makes the
 * tracer include the whole directory under the known prefix — the entire
 * project root, in the cwd case — into every function bundle. That is what
 * an earlier, parameterised version of this helper did to production.
 *
 * Returns the first candidate that exists, or the first candidate (for the
 * error message) when none does.
 */
export function firstExistingPath(first: string, ...rest: string[]): string {
  for (const candidate of [first, ...rest]) {
    if (existsSync(candidate)) return candidate;
  }
  return first;
}
