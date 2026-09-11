import { z } from "zod";
import type { SwarmCmd, SwarmCmdResponse } from "./cmd";

/**
 * FluentBit log-volume telemetry (GetFluentbitStats).
 *
 * Response shape is pinned in `__fixtures__/fluentbit-stats.contract.json`.
 * That fixture is the only place these external field names may appear
 * outside this parser; when the swarm contract changes, reconciling is:
 * update the fixture, update the schema below, re-run the parser tests.
 *
 * Never fabricate a number: unobserved counters stay null, never 0.
 */

/** Outbound command, built server-side from this constant only — never from request input. */
export const GET_FLUENTBIT_STATS_CMD: SwarmCmd = {
  type: "Swarm",
  data: { cmd: "GetFluentbitStats" },
};

export type FluentbitStatsStatus =
  | "OK"
  | "PARTIAL"
  | "UNAVAILABLE"
  | "ERROR"
  | "UNREACHABLE";

/** Machine-readable reason when status is ERROR or UNREACHABLE. */
export type FluentbitStatsFailureReason = "STACK_ERROR" | "MALFORMED" | "UNREACHABLE";

const MAX_ARRAY_ENTRIES = 64;
const MAX_STRING_LENGTH = 256;

const capString = (value: string) => value.slice(0, MAX_STRING_LENGTH);
const capArray = <T>(items: T[]) => items.slice(0, MAX_ARRAY_ENTRIES);

const cappedString = z.string().transform(capString);
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const requiredCounter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const contractContainerSchema = z.object({
  container_name: cappedString,
  input_bytes: requiredCounter,
  input_records: requiredCounter,
});

const contractErrorSchema = z.union([
  cappedString,
  z.object({
    collector: cappedString,
    reason: cappedString,
  }),
]);

export const fluentbitStatsSchema = z.object({
  available: z.boolean(),
  collected_at: z.number().int(),
  input_bytes: counter,
  input_records: counter,
  output_proc_bytes: counter,
  output_proc_records: counter,
  filter_drop_records: counter,
  output_dropped_records: counter,
  output_errors: counter,
  retries_failed: counter,
  uptime_seconds: counter,
  errors: z.array(contractErrorSchema).transform(capArray),
  containers: z.array(contractContainerSchema).transform(capArray).optional(),
});

/** Wire shape of the pinned contract fixture. */
export type FluentbitStatsContract = z.infer<typeof fluentbitStatsSchema>;

export const MIN_DT_SECONDS = 1;
export const MAX_DT_SECONDS = 600;
export const MAX_BYTES_PER_SEC = 1e10;
export const MAX_RECORDS_PER_SEC = 1e8;

export interface FluentbitRates {
  inputBytesPerSec: number | null;
  inputRecordsPerSec: number | null;
  outputProcBytesPerSec: number | null;
  outputProcRecordsPerSec: number | null;
}

export interface FluentbitPrevSample {
  collectedAt: number;
  inputBytes: number | null;
  inputRecords: number | null;
  outputProcBytes: number | null;
  outputProcRecords: number | null;
}

export const NULL_FLUENTBIT_RATES: FluentbitRates = {
  inputBytesPerSec: null,
  inputRecordsPerSec: null,
  outputProcBytesPerSec: null,
  outputProcRecordsPerSec: null,
};

export interface FluentbitStatsContainer {
  containerName: string;
  inputBytes: number;
  inputRecords: number;
}

export interface FluentbitStatsReading {
  status: FluentbitStatsStatus;
  /** Only set when status is ERROR or UNREACHABLE. */
  reason?: FluentbitStatsFailureReason;
  available: boolean;
  collectedAt: number | null;
  inputBytes: number | null;
  inputRecords: number | null;
  outputProcBytes: number | null;
  outputProcRecords: number | null;
  filterDropRecords: number | null;
  outputDroppedRecords: number | null;
  outputErrors: number | null;
  retriesFailed: number | null;
  uptimeSeconds: number | null;
  errors: string[];
  /** Per-container lifetime totals. Null when omitted or empty — never fabricated. */
  containers: FluentbitStatsContainer[] | null;
  rates: FluentbitRates;
  rateWindowSeconds: number | null;
}

function isFiniteNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) && value >= 0;
}

function isFiniteInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

/**
 * Validate a prev-sample blob (Redis or caller-supplied) before rate math.
 * Corrupt / missing shape returns null so the caller treats it as a first sample.
 */
export function parseFluentbitPrevSample(value: unknown): FluentbitPrevSample | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isFiniteInt(v.collectedAt)) return null;
  const keys = ["inputBytes", "inputRecords", "outputProcBytes", "outputProcRecords"] as const;
  for (const key of keys) {
    if (!(key in v)) return null;
    const c = v[key];
    if (c !== null && !isFiniteNonNegativeInt(c)) return null;
  }
  return {
    collectedAt: v.collectedAt,
    inputBytes: v.inputBytes as number | null,
    inputRecords: v.inputRecords as number | null,
    outputProcBytes: v.outputProcBytes as number | null,
    outputProcRecords: v.outputProcRecords as number | null,
  };
}

export function fluentbitPrevSampleFromReading(
  reading: FluentbitStatsReading,
): FluentbitPrevSample | null {
  if (!isFiniteInt(reading.collectedAt)) return null;
  return {
    collectedAt: reading.collectedAt,
    inputBytes: reading.inputBytes,
    inputRecords: reading.inputRecords,
    outputProcBytes: reading.outputProcBytes,
    outputProcRecords: reading.outputProcRecords,
  };
}

function counterRate(
  prev: number | null,
  curr: number | null,
  deltaSeconds: number,
  maxRate: number,
): number | null {
  if (prev === null || curr === null) return null;
  if (!isFiniteNonNegativeInt(prev) || !isFiniteNonNegativeInt(curr)) return null;
  if (curr < prev) return null;
  const rate = (curr - prev) / deltaSeconds;
  if (!Number.isFinite(rate) || rate < 0 || rate > maxRate) return null;
  return rate;
}

/**
 * Pure rate helper. Rates exist only for the four volume counters.
 * A rate is `(curr − prev) / Δt` only when every guard below holds;
 * otherwise that rate is null — never 0, never Infinity/NaN.
 */
export function computeFluentbitRates(
  prev: FluentbitPrevSample | null,
  curr: FluentbitPrevSample,
): { rates: FluentbitRates; rateWindowSeconds: number | null } {
  const validPrev = parseFluentbitPrevSample(prev);
  const validCurr = parseFluentbitPrevSample(curr);
  if (!validPrev || !validCurr) {
    return { rates: { ...NULL_FLUENTBIT_RATES }, rateWindowSeconds: null };
  }

  const deltaSeconds = validCurr.collectedAt - validPrev.collectedAt;
  if (
    !Number.isFinite(deltaSeconds) ||
    deltaSeconds < MIN_DT_SECONDS ||
    deltaSeconds > MAX_DT_SECONDS
  ) {
    return { rates: { ...NULL_FLUENTBIT_RATES }, rateWindowSeconds: null };
  }

  const rates: FluentbitRates = {
    inputBytesPerSec: counterRate(
      validPrev.inputBytes,
      validCurr.inputBytes,
      deltaSeconds,
      MAX_BYTES_PER_SEC,
    ),
    inputRecordsPerSec: counterRate(
      validPrev.inputRecords,
      validCurr.inputRecords,
      deltaSeconds,
      MAX_RECORDS_PER_SEC,
    ),
    outputProcBytesPerSec: counterRate(
      validPrev.outputProcBytes,
      validCurr.outputProcBytes,
      deltaSeconds,
      MAX_BYTES_PER_SEC,
    ),
    outputProcRecordsPerSec: counterRate(
      validPrev.outputProcRecords,
      validCurr.outputProcRecords,
      deltaSeconds,
      MAX_RECORDS_PER_SEC,
    ),
  };

  const anyRate = Object.values(rates).some((r) => r !== null);
  return { rates, rateWindowSeconds: anyRate ? deltaSeconds : null };
}

function isStackErrorBody(body: unknown): body is { stack_error: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    "stack_error" in body &&
    typeof (body as Record<string, unknown>).stack_error === "string"
  );
}

function failureReading(
  status: "ERROR" | "UNREACHABLE",
  reason: FluentbitStatsFailureReason,
): FluentbitStatsReading {
  return {
    status,
    reason,
    available: false,
    collectedAt: null,
    inputBytes: null,
    inputRecords: null,
    outputProcBytes: null,
    outputProcRecords: null,
    filterDropRecords: null,
    outputDroppedRecords: null,
    outputErrors: null,
    retriesFailed: null,
    uptimeSeconds: null,
    errors: [],
    containers: null,
    rates: { ...NULL_FLUENTBIT_RATES },
    rateWindowSeconds: null,
  };
}

function normalizeError(
  entry: FluentbitStatsContract["errors"][number],
): string {
  if (typeof entry === "string") return entry;
  return `${entry.collector}: ${entry.reason}`;
}

function normalizeContainers(
  containers: FluentbitStatsContract["containers"],
): FluentbitStatsContainer[] | null {
  if (!containers || containers.length === 0) return null;
  return containers.map((c) => ({
    containerName: c.container_name,
    inputBytes: c.input_bytes,
    inputRecords: c.input_records,
  }));
}

function normalizeReading(
  contract: FluentbitStatsContract,
  status: "OK" | "PARTIAL" | "UNAVAILABLE",
): FluentbitStatsReading {
  return {
    status,
    available: contract.available,
    collectedAt: contract.collected_at,
    inputBytes: contract.input_bytes,
    inputRecords: contract.input_records,
    outputProcBytes: contract.output_proc_bytes,
    outputProcRecords: contract.output_proc_records,
    filterDropRecords: contract.filter_drop_records,
    outputDroppedRecords: contract.output_dropped_records,
    outputErrors: contract.output_errors,
    retriesFailed: contract.retries_failed,
    uptimeSeconds: contract.uptime_seconds,
    errors: contract.errors.map(normalizeError),
    containers: normalizeContainers(contract.containers),
    rates: { ...NULL_FLUENTBIT_RATES },
    rateWindowSeconds: null,
  };
}

/**
 * Normalise a GetFluentbitStats response into a whitelisted reading.
 *
 * Status classification (explicit rule — parser and UI cannot drift):
 * - OK           well-formed body, available === true, no errors[]
 * - PARTIAL      well-formed body, available === true, non-empty errors[]
 * - UNAVAILABLE  well-formed body, available === false (cacheable, not a failure)
 * - ERROR        body carries stack_error, or fails validation (MALFORMED)
 * - UNREACHABLE  no usable body (timeout, DNS, connection refused, non-2xx)
 *
 * Null counters are preserved as null in every status — never fabricated to 0.
 * Rates are left null here; the read path attaches them from the prev sample.
 */
export function parseFluentbitStats(response: SwarmCmdResponse): FluentbitStatsReading {
  const body = response.data;

  if (isStackErrorBody(body)) {
    return failureReading("ERROR", "STACK_ERROR");
  }

  if (body === undefined || body === null) {
    return failureReading("UNREACHABLE", "UNREACHABLE");
  }

  if (!response.ok) {
    return failureReading("UNREACHABLE", "UNREACHABLE");
  }

  const parsed = fluentbitStatsSchema.safeParse(body);
  if (!parsed.success) {
    return failureReading("ERROR", "MALFORMED");
  }
  const contract = parsed.data;

  if (!contract.available) {
    return normalizeReading(contract, "UNAVAILABLE");
  }

  const status: "OK" | "PARTIAL" = contract.errors.length > 0 ? "PARTIAL" : "OK";
  return normalizeReading(contract, status);
}
