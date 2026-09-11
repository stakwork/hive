import type { FluentbitStatsContainer } from "@/services/swarm/fluentbit-stats";

/**
 * Day-bucketed FluentBit ingest rollups. Pure functions — no DB or network.
 *
 * Ingest is the sum of positive consecutive counter deltas, attributed to the
 * UTC calendar day of the later sample. Counter resets (negative deltas) and
 * null sides are skipped per field. A day with no usable positive delta is
 * `null`, never `0`.
 */

const MAX_ARRAY_ENTRIES = 64;
const MAX_STRING_LENGTH = 256;

export interface FluentbitIngestBucket {
  inputBytes: number | null;
  inputRecords: number | null;
}

export interface FluentbitIngest {
  today: FluentbitIngestBucket;
  yesterday: FluentbitIngestBucket;
  last7Days: FluentbitIngestBucket;
}

export interface FluentbitContainerToday {
  containerName: string;
  inputBytes: number | null;
  inputRecords: number | null;
}

export interface FluentbitRollupSample {
  collectedAt: Date;
  inputBytes: bigint | number | null;
  inputRecords: bigint | number | null;
}

export interface FluentbitContainerSample {
  collectedAt: Date;
  containers: unknown;
}

function isFiniteNonNegativeInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

function asBigInt(value: bigint | number | null | undefined): bigint | null {
  if (value == null) return null;
  if (typeof value === "bigint") {
    return value >= BigInt(0) ? value : null;
  }
  if (isFiniteNonNegativeInt(value)) return BigInt(value);
  return null;
}

function bigintToNumber(value: bigint | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function utcDayKeyOffset(now: Date, days: number): string {
  const d = utcDayStart(now);
  d.setUTCDate(d.getUTCDate() + days);
  return utcDayKey(d);
}

function parseCounter(value: unknown): number | null {
  if (typeof value === "bigint") {
    if (value < BigInt(0)) return null;
    const n = Number(value);
    return Number.isFinite(n) && n <= Number.MAX_SAFE_INTEGER ? n : null;
  }
  return isFiniteNonNegativeInt(value) ? value : null;
}

function parseContainerEntry(item: unknown): FluentbitStatsContainer | null {
  if (item === null || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  const rawName =
    typeof row.containerName === "string"
      ? row.containerName
      : typeof row.container_name === "string"
        ? row.container_name
        : null;
  if (rawName === null) return null;
  const inputBytes = parseCounter(row.inputBytes ?? row.input_bytes);
  const inputRecords = parseCounter(row.inputRecords ?? row.input_records);
  if (inputBytes === null || inputRecords === null) return null;
  return {
    containerName: rawName.slice(0, MAX_STRING_LENGTH),
    inputBytes,
    inputRecords,
  };
}

/**
 * Re-validate stored `containers` JSON with the parser whitelist/caps.
 * Corrupt or malformed blobs return null — never throw.
 */
export function parseStoredFluentbitContainers(
  value: unknown,
): FluentbitStatsContainer[] | null {
  try {
    if (!Array.isArray(value) || value.length === 0) return null;
    const out: FluentbitStatsContainer[] = [];
    for (const item of value.slice(0, MAX_ARRAY_ENTRIES)) {
      const parsed = parseContainerEntry(item);
      if (parsed) out.push(parsed);
    }
    return out.length === 0 ? null : out;
  } catch {
    return null;
  }
}

function addPositiveDelta(
  map: Map<string, bigint>,
  day: string,
  prev: bigint | null,
  curr: bigint | null,
): void {
  if (prev === null || curr === null) return;
  if (curr < prev) return;
  const delta = curr - prev;
  if (delta <= BigInt(0)) return;
  map.set(day, (map.get(day) ?? BigInt(0)) + delta);
}

function bucketFromMap(map: Map<string, bigint>, day: string): number | null {
  return bigintToNumber(map.get(day) ?? null);
}

function sumDays(map: Map<string, bigint>, days: string[]): number | null {
  let sum = BigInt(0);
  let any = false;
  for (const day of days) {
    const value = map.get(day);
    if (value === undefined) continue;
    sum += value;
    any = true;
  }
  return any ? bigintToNumber(sum) : null;
}

function sortByCollectedAt<T extends { collectedAt: Date }>(samples: T[]): T[] {
  return samples
    .filter((s) => isValidDate(s.collectedAt))
    .slice()
    .sort((a, b) => a.collectedAt.getTime() - b.collectedAt.getTime());
}

export function computeIngestBuckets(
  samples: FluentbitRollupSample[],
  now: Date = new Date(),
): FluentbitIngest {
  const todayKey = utcDayKeyOffset(now, 0);
  const yesterdayKey = utcDayKeyOffset(now, -1);
  const last7Keys = Array.from({ length: 7 }, (_, i) => utcDayKeyOffset(now, -i));

  const sorted = sortByCollectedAt(samples);
  const dayBytes = new Map<string, bigint>();
  const dayRecords = new Map<string, bigint>();

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const day = utcDayKey(curr.collectedAt);
    addPositiveDelta(dayBytes, day, asBigInt(prev.inputBytes), asBigInt(curr.inputBytes));
    addPositiveDelta(
      dayRecords,
      day,
      asBigInt(prev.inputRecords),
      asBigInt(curr.inputRecords),
    );
  }

  return {
    today: {
      inputBytes: bucketFromMap(dayBytes, todayKey),
      inputRecords: bucketFromMap(dayRecords, todayKey),
    },
    yesterday: {
      inputBytes: bucketFromMap(dayBytes, yesterdayKey),
      inputRecords: bucketFromMap(dayRecords, yesterdayKey),
    },
    last7Days: {
      inputBytes: sumDays(dayBytes, last7Keys),
      inputRecords: sumDays(dayRecords, last7Keys),
    },
  };
}

function findContainer(
  containers: FluentbitStatsContainer[] | null,
  name: string,
): FluentbitStatsContainer | null {
  if (!containers) return null;
  return containers.find((c) => c.containerName === name) ?? null;
}

function containersFromSample(
  sample: FluentbitContainerSample,
): FluentbitStatsContainer[] | null {
  return parseStoredFluentbitContainers(sample.containers);
}

/**
 * Current-day per-container ingest.
 *
 * Latest point is the live reading when it has a non-empty container list;
 * otherwise the latest today-sample that parses. Baseline prefers the last
 * pre-today sample for that name, else the first today sample if it is a
 * different point. New containers (no baseline) are included at latest
 * lifetime. Negative deltas (restart) omit the row.
 */
export function computeContainersToday(
  liveContainers: FluentbitStatsContainer[] | null,
  samplesToday: FluentbitContainerSample[],
  samplesBeforeToday: FluentbitContainerSample[],
  _now: Date = new Date(),
): FluentbitContainerToday[] | null {
  const todaySorted = sortByCollectedAt(samplesToday);
  const beforeSorted = sortByCollectedAt(samplesBeforeToday);

  const live = liveContainers && liveContainers.length > 0 ? liveContainers : null;

  let latestContainers: FluentbitStatsContainer[] | null = live;
  let latestCollectedAt: number | null = null;

  if (!latestContainers) {
    for (let i = todaySorted.length - 1; i >= 0; i--) {
      const parsed = containersFromSample(todaySorted[i]);
      if (parsed && parsed.length > 0) {
        latestContainers = parsed;
        latestCollectedAt = todaySorted[i].collectedAt.getTime();
        break;
      }
    }
  }

  if (!latestContainers || latestContainers.length === 0) {
    return null;
  }

  const rows: FluentbitContainerToday[] = [];

  for (const latest of latestContainers) {
    let baseline: FluentbitStatsContainer | null = null;

    for (let i = beforeSorted.length - 1; i >= 0; i--) {
      const parsed = containersFromSample(beforeSorted[i]);
      const match = findContainer(parsed, latest.containerName);
      if (match) {
        baseline = match;
        break;
      }
    }

    if (!baseline) {
      for (const sample of todaySorted) {
        if (latestCollectedAt !== null && sample.collectedAt.getTime() === latestCollectedAt) {
          continue;
        }
        const parsed = containersFromSample(sample);
        const match = findContainer(parsed, latest.containerName);
        if (match) {
          baseline = match;
          break;
        }
      }
    }

    if (!baseline) {
      rows.push({
        containerName: latest.containerName,
        inputBytes: latest.inputBytes,
        inputRecords: latest.inputRecords,
      });
      continue;
    }

    const bytesDelta = latest.inputBytes - baseline.inputBytes;
    const recordsDelta = latest.inputRecords - baseline.inputRecords;
    if (bytesDelta < 0 || recordsDelta < 0) continue;

    rows.push({
      containerName: latest.containerName,
      inputBytes: bytesDelta,
      inputRecords: recordsDelta,
    });
  }

  return rows;
}
