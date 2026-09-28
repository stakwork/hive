/**
 * Bounded-concurrency helper — same pattern as
 * `src/lib/harvey-lab/fix-chain-walker.ts#batchedAll`, duplicated locally
 * rather than imported to keep this feature's dependency surface self
 * contained (that module pulls in Jarvis-specific types).
 *
 * Runs `tasks` with at most `limit` in flight at once. Results are
 * returned in the same order as `tasks`.
 */
export async function batchedAll<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}
