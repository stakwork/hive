/**
 * Compact streaming latency sketch for p50/p95/p99 computation.
 *
 * Uses a logarithmic-bin DDSketch-style approach:
 * - Values are mapped to bins via log(value / minValue) / log(gamma)
 * - Each bin accumulates a count
 * - Quantiles are resolved by scanning bins until the target rank is reached
 *
 * Accuracy: within ~1% relative error for p50/p95/p99 on latency distributions.
 * No external runtime dependency — fully self-contained.
 */

const GAMMA = 1.02; // ~1% relative accuracy
const LOG_GAMMA = Math.log(GAMMA);
const MIN_VALUE = 1e-9; // values below this are clamped to the first bin

export interface LatencySketch {
  bins: Record<number, number>; // binIndex → count
  count: number;
  sum: number; // for mean (not used for percentiles but useful for debugging)
}

export type SerializedSketch = {
  bins: Array<[number, number]>; // [binIndex, count][]
  count: number;
  sum: number;
};

/** Create a new empty sketch. */
export function createSketch(): LatencySketch {
  return { bins: {}, count: 0, sum: 0 };
}

/** Map a value ≥ 0 to its bin index. */
function binIndex(value: number): number {
  const v = Math.max(value, MIN_VALUE);
  return Math.ceil(Math.log(v) / LOG_GAMMA);
}

/**
 * Insert a single value (e.g. duration in ms) into the sketch.
 * Returns the mutated sketch (mutates in place for performance).
 */
export function insert(sketch: LatencySketch, value: number): LatencySketch {
  const idx = binIndex(value);
  sketch.bins[idx] = (sketch.bins[idx] ?? 0) + 1;
  sketch.count += 1;
  sketch.sum += value;
  return sketch;
}

/**
 * Merge `other` into `base` (mutates `base` in place).
 * Useful for combining distributed sketch fragments.
 */
export function merge(base: LatencySketch, other: LatencySketch): LatencySketch {
  for (const [idxStr, cnt] of Object.entries(other.bins)) {
    const idx = Number(idxStr);
    base.bins[idx] = (base.bins[idx] ?? 0) + cnt;
  }
  base.count += other.count;
  base.sum += other.sum;
  return base;
}

/**
 * Compute the q-th quantile (0 < q < 1) from the sketch.
 * Returns 0 when the sketch is empty.
 *
 * The returned value is the upper bound of the target bin, which gives a
 * slight over-estimate that keeps latency SLOs conservative.
 */
export function quantile(sketch: LatencySketch, q: number): number {
  if (sketch.count === 0) return 0;

  // Sort bin indices ascending
  const sortedIndices = Object.keys(sketch.bins)
    .map(Number)
    .sort((a, b) => a - b);

  const targetRank = q * sketch.count;
  let cumulative = 0;

  for (const idx of sortedIndices) {
    cumulative += sketch.bins[idx];
    if (cumulative >= targetRank) {
      // Upper bound of this bin: gamma^idx
      return Math.pow(GAMMA, idx);
    }
  }

  // Fallback: return upper bound of highest bin
  const lastIdx = sortedIndices[sortedIndices.length - 1];
  return Math.pow(GAMMA, lastIdx);
}

/** Serialize a sketch to a JSON-safe object for DB storage. */
export function serialize(sketch: LatencySketch): SerializedSketch {
  return {
    bins: Object.entries(sketch.bins).map(([k, v]) => [Number(k), v] as [number, number]),
    count: sketch.count,
    sum: sketch.sum,
  };
}

/** Deserialize a sketch from DB storage. */
export function deserialize(data: SerializedSketch): LatencySketch {
  const bins: Record<number, number> = {};
  for (const [idx, cnt] of data.bins) {
    bins[idx] = cnt;
  }
  return { bins, count: data.count, sum: data.sum };
}
