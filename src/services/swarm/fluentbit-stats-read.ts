import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { EncryptionService } from "@/lib/encryption";
import {
  getSwarmCmdJwt,
  swarmCmdRequest,
  SwarmAuthError,
  SwarmCmdConfigError,
  type SwarmCmdResponse,
} from "./cmd";
import {
  GET_FLUENTBIT_STATS_CMD,
  parseFluentbitStats,
  computeFluentbitRates,
  parseFluentbitPrevSample,
  fluentbitPrevSampleFromReading,
  NULL_FLUENTBIT_RATES,
  type FluentbitStatsReading,
  type FluentbitPrevSample,
} from "./fluentbit-stats";
import {
  HOST_STORAGE_INSTANCE_ID_PATTERN,
  resolveSwarmHost,
  isAllowedSwarmHost,
  isEncryptedEnvelope,
  isAbortErrorLike,
} from "./host-storage-read";

/**
 * Single live `GetFluentbitStats` read against the swarm backing an EC2 instance.
 *
 * Mirrors `readHostStorage`: DB-path credentials only, host-allowlist before
 * auth, instance-id gate before any DB/cache lookup. Two Redis keys:
 * a 60s cooldown of the already-rated reading, and a 600s prev-sample used
 * only on the next live read. Cooldown hits never recompute rates.
 *
 * Logging is boundary-only with a `[FluentbitStats]` prefix. Raw swarm
 * response bodies and JWT/password material are never logged.
 */

const LOG_PREFIX = "[FluentbitStats]";

/** Per-request timeout for the login and the cmd round-trip (15–20s window). */
const READ_TIMEOUT_MS = 18_000;

const COOLDOWN_TTL_SECONDS = 60;
const COOLDOWN_KEY_PREFIX = "admin:swarms:fluentbit-stats:";

const PREV_TTL_SECONDS = 600;
const PREV_KEY_PREFIX = "admin:swarms:fluentbit-prev:";

export type FluentbitStatsReadOutcome =
  | "fresh"
  | "cached"
  | "unreachable"
  | "no_swarm_record"
  | "ambiguous"
  | "failed";

export type FluentbitStatsReadReasonCode =
  | "INVALID_INSTANCE_ID"
  | "NO_SWARM_RECORD"
  | "AMBIGUOUS"
  | "CONFIG_INVALID"
  | "WORKSPACE_DELETED"
  | "DECRYPT_FAILED"
  | "AUTH_FAILED"
  | "TIMEOUT"
  | `HTTP_${number}`
  | "MALFORMED"
  | "UNREACHABLE"
  | "STACK_ERROR";

export interface FluentbitStatsReadResult {
  outcome: FluentbitStatsReadOutcome;
  /** Normalised reading for `fresh` and `cached` outcomes. */
  reading?: FluentbitStatsReading;
  /** Original swarm-side collection timestamp (unix seconds) for `fresh`/`cached`. */
  collectedAt?: number | null;
  reasonCode?: FluentbitStatsReadReasonCode;
  /** True only when the reading was served from the Hive cooldown cache. */
  cached: boolean;
  /** Present on recovery-eligible failures (`DECRYPT_FAILED`, `AUTH_FAILED`). */
  workspaceId?: string;
}

const encryptionService = EncryptionService.getInstance();

function logFailure(
  swarmId: string | null,
  instanceId: string,
  reasonCode: FluentbitStatsReadReasonCode,
): void {
  const log = swarmId ? console.error : console.warn;
  if (swarmId) {
    log(`${LOG_PREFIX} failure swarmId=${swarmId} instance=${instanceId} reason=${reasonCode}`);
  } else {
    log(`${LOG_PREFIX} failure instance=${instanceId} reason=${reasonCode}`);
  }
}

function result(
  outcome: FluentbitStatsReadOutcome,
  reasonCode: FluentbitStatsReadReasonCode | undefined,
  swarmId: string | null,
  instanceId: string,
  workspaceId?: string | null,
): FluentbitStatsReadResult {
  if (reasonCode) logFailure(swarmId, instanceId, reasonCode);
  return workspaceId
    ? { outcome, reasonCode, cached: false, workspaceId }
    : { outcome, reasonCode, cached: false };
}

interface CooldownPayload {
  reading: FluentbitStatsReading;
}

function isCacheableReading(reading: FluentbitStatsReading | undefined): reading is FluentbitStatsReading {
  return (
    !!reading &&
    (reading.status === "OK" || reading.status === "PARTIAL" || reading.status === "UNAVAILABLE") &&
    typeof reading.collectedAt === "number"
  );
}

async function readCooldownCache(instanceId: string): Promise<FluentbitStatsReadResult | null> {
  let raw: string | null;
  try {
    raw = await redis.get(COOLDOWN_KEY_PREFIX + instanceId);
  } catch {
    console.warn(`${LOG_PREFIX} cooldown cache unavailable instance=${instanceId}`);
    return null;
  }
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw) as CooldownPayload;
    const reading = payload?.reading;
    if (isCacheableReading(reading)) {
      return { outcome: "cached", reading, collectedAt: reading.collectedAt, cached: true };
    }
  } catch {
    // Corrupt entry — fall through to a live read.
  }
  return null;
}

async function writeCooldownCache(instanceId: string, reading: FluentbitStatsReading): Promise<void> {
  try {
    await redis.setex(
      COOLDOWN_KEY_PREFIX + instanceId,
      COOLDOWN_TTL_SECONDS,
      JSON.stringify({ reading } satisfies CooldownPayload),
    );
  } catch {
    console.warn(`${LOG_PREFIX} cooldown cache write failed instance=${instanceId}`);
  }
}

async function readPrevSample(instanceId: string): Promise<FluentbitPrevSample | null> {
  let raw: string | null;
  try {
    raw = await redis.get(PREV_KEY_PREFIX + instanceId);
  } catch {
    console.warn(`${LOG_PREFIX} prev-sample cache unavailable instance=${instanceId}`);
    return null;
  }
  if (!raw) return null;
  try {
    return parseFluentbitPrevSample(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writePrevSample(instanceId: string, sample: FluentbitPrevSample): Promise<void> {
  try {
    await redis.setex(
      PREV_KEY_PREFIX + instanceId,
      PREV_TTL_SECONDS,
      JSON.stringify(sample),
    );
  } catch {
    console.warn(`${LOG_PREFIX} prev-sample cache write failed instance=${instanceId}`);
  }
}

function attachRates(
  reading: FluentbitStatsReading,
  prev: FluentbitPrevSample | null,
): FluentbitStatsReading {
  const curr = fluentbitPrevSampleFromReading(reading);
  if (!curr) {
    return {
      ...reading,
      rates: { ...NULL_FLUENTBIT_RATES },
      rateWindowSeconds: null,
    };
  }
  const { rates, rateWindowSeconds } = computeFluentbitRates(prev, curr);
  return { ...reading, rates, rateWindowSeconds };
}

export interface FluentbitStatsReadOptions {
  /** Skip the Redis cooldown read and always perform a live fetch. Cron-only. */
  bypassCooldown?: boolean;
  /** Skip writing cooldown / prev-sample Redis keys after a fresh read. Cron-only. */
  skipWriteCache?: boolean;
}

/**
 * Perform one live FluentBit-stats read for an EC2 instance. Never throws —
 * every failure is classified into the outcome discriminator.
 *
 * `options` is in-process only (cron sampler). Callers must never source
 * `bypassCooldown` / `skipWriteCache` from request query or body.
 */
export async function readFluentbitStats(
  instanceId: string,
  options: FluentbitStatsReadOptions = {},
): Promise<FluentbitStatsReadResult> {
  // 1. Input gate — before ANY DB query or cache lookup.
  if (!HOST_STORAGE_INSTANCE_ID_PATTERN.test(instanceId)) {
    return result("failed", "INVALID_INSTANCE_ID", null, instanceId);
  }

  // 2. Cooldown cache — inside the TTL there is no outbound call, no DB query,
  //    no credential decryption, and no prev lookup / rate recompute. The
  //    cached reading keeps its ORIGINAL collectedAt and baked-in rates.
  //    Sampler passes bypassCooldown so the cron always hits live.
  if (!options.bypassCooldown) {
    const cached = await readCooldownCache(instanceId);
    if (cached) {
      console.log(`${LOG_PREFIX} cooldown hit instance=${instanceId}`);
      return cached;
    }
  }

  // 3. Resolve the swarm — exactly one match, never an arbitrary pick.
  const swarms = await db.swarm.findMany({
    where: { ec2Id: instanceId },
    select: {
      id: true,
      swarmUrl: true,
      swarmPassword: true,
      workspaceId: true,
      workspace: { select: { deleted: true } },
    },
  });
  if (swarms.length === 0) {
    return result("no_swarm_record", "NO_SWARM_RECORD", null, instanceId);
  }
  if (swarms.length > 1) {
    return result("ambiguous", "AMBIGUOUS", null, instanceId);
  }
  const swarm = swarms[0];

  console.log(`${LOG_PREFIX} read attempt instance=${instanceId} swarmId=${swarm.id}`);

  // 4. Skip conditions — no decrypt, no transmission.
  if (swarm.workspace?.deleted) {
    return result("failed", "WORKSPACE_DELETED", swarm.id, instanceId);
  }
  if (!swarm.swarmUrl || !swarm.swarmPassword) {
    return result("failed", "CONFIG_INVALID", swarm.id, instanceId);
  }

  // 5. Host allowlist BEFORE authentication.
  const hostname = resolveSwarmHost(swarm.swarmUrl);
  if (!hostname || !isAllowedSwarmHost(hostname)) {
    return result("failed", "CONFIG_INVALID", swarm.id, instanceId);
  }

  // 6. Credentials — DB path only.
  if (!isEncryptedEnvelope(swarm.swarmPassword)) {
    return result("failed", "DECRYPT_FAILED", swarm.id, instanceId, swarm.workspaceId);
  }
  let password: string;
  try {
    password = encryptionService.decryptField("swarmPassword", swarm.swarmPassword);
  } catch {
    return result("failed", "DECRYPT_FAILED", swarm.id, instanceId, swarm.workspaceId);
  }

  // 7. Login.
  let jwt: string;
  try {
    jwt = await getSwarmCmdJwt(swarm.swarmUrl, password, "admin", READ_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof SwarmCmdConfigError) {
      return result("failed", "CONFIG_INVALID", swarm.id, instanceId);
    }
    if (isAbortErrorLike(error)) {
      return result("unreachable", "TIMEOUT", swarm.id, instanceId);
    }
    if (error instanceof SwarmAuthError && error.status === 401) {
      return result("failed", "AUTH_FAILED", swarm.id, instanceId, swarm.workspaceId);
    }
    if (error instanceof SwarmAuthError) {
      return result("unreachable", `HTTP_${error.status}`, swarm.id, instanceId);
    }
    return result("unreachable", "UNREACHABLE", swarm.id, instanceId);
  }

  // 8. Read + parse. Command object is the server-side constant only.
  let response: SwarmCmdResponse;
  try {
    response = await swarmCmdRequest({
      swarmUrl: swarm.swarmUrl,
      jwt,
      cmd: GET_FLUENTBIT_STATS_CMD,
      timeoutMs: READ_TIMEOUT_MS,
    });
  } catch {
    return result("unreachable", "UNREACHABLE", swarm.id, instanceId);
  }

  const parsed = parseFluentbitStats(response);

  if (parsed.status === "UNAVAILABLE") {
    const reading: FluentbitStatsReading = {
      ...parsed,
      rates: { ...NULL_FLUENTBIT_RATES },
      rateWindowSeconds: null,
    };
    if (!options.skipWriteCache) {
      await writeCooldownCache(instanceId, reading);
    }
    return { outcome: "fresh", reading, collectedAt: reading.collectedAt, cached: false };
  }

  if (parsed.status === "OK" || parsed.status === "PARTIAL") {
    const prev = await readPrevSample(instanceId);
    const reading = attachRates(parsed, prev);
    if (!options.skipWriteCache) {
      await writeCooldownCache(instanceId, reading);
      const snapshot = fluentbitPrevSampleFromReading(reading);
      if (snapshot) {
        await writePrevSample(instanceId, snapshot);
      }
    }
    return { outcome: "fresh", reading, collectedAt: reading.collectedAt, cached: false };
  }

  if (parsed.status === "UNREACHABLE") {
    const reasonCode: FluentbitStatsReadReasonCode =
      response.errorCode === "TIMEOUT"
        ? "TIMEOUT"
        : response.ok || response.status <= 0
          ? "UNREACHABLE"
          : `HTTP_${response.status}`;
    return result("unreachable", reasonCode, swarm.id, instanceId);
  }

  return result(
    "failed",
    parsed.reason === "STACK_ERROR" ? "STACK_ERROR" : "MALFORMED",
    swarm.id,
    instanceId,
  );
}
