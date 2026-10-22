/**
 * Mock mode: graph and job reads answer at once, prod's take a while. Set
 * `MOCK_GRAPH_LATENCY_MS` to make each mock read wait about that long (half
 * to one and a half times it), so slow-read bugs show up locally.
 */
export function mockLatency(): Promise<void> {
  const ms = Number(process.env.MOCK_GRAPH_LATENCY_MS) || 0;
  return ms > 0 ? new Promise((r) => setTimeout(r, ms * (0.5 + Math.random()))) : Promise.resolve();
}
