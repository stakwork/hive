import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { EncryptionService, isEncrypted } from "@/lib/encryption";
import {
  getSwarmCmdJwt,
  swarmCmdRequest,
  SwarmCmdConfigError,
  type SwarmCmdResponse,
} from "./cmd";
import {
  GET_HOST_STORAGE_CMD,
  parseHostStorage,
  type HostStorageReading,
} from "./host-storage";

/**
 * Single live `GetHostStorage` read against the swarm backing an EC2 instance.
 *
 * Credential resolution is the DB path only (`encryptionService.decryptField`),
 * never `fetchSwarmCredentials` (which depends on a warm `admin:swarms:list`
 * Redis cache that may be cold). The resolved `swarmUrl` comes from the matched
 * `Swarm` row — never from caller input — and is checked against an allowed
 * host suffix before anything authenticates, because the login request itself
 * transmits the swarm password.
 *
 * A Redis cooldown cache (TTL aligned with the swarm's own 60s cache) shields
 * the swarm from repeated reads: within the TTL a call makes no outbound
 * request, no credential decryption, and returns the ORIGINAL reading with its
 * original `collectedAt` — never restamped.
 *
 * Logging is boundary-only with a `[HostStorage]` prefix: read attempt
 * (swarmId) and failures (swarmId + reason code). Raw swarm response bodies and
 * raw JWT-login error text are never logged or returned — `getSwarmCmdJwt`
 * embeds the swarm's raw response in its error message, so errors are mapped to
 * reason codes at this boundary and the message is discarded.
 */

const LOG_PREFIX = "[HostStorage]";

/** EC2 instance ids. Validated BEFORE any DB query: `Swarm.ec2Id` has no
 * unique constraint and Prisma silently drops undefined/empty filters, so a
 * malformed id must never reach `findMany` (it would scan the whole table). */
export const HOST_STORAGE_INSTANCE_ID_PATTERN = /^i-[0-9a-f]+$/;

/** Per-request timeout for the login and the cmd round-trip (15–20s window). */
const READ_TIMEOUT_MS = 18_000;

/** Aligned with the swarm's own GetHostStorage cache window. */
const COOLDOWN_TTL_SECONDS = 60;
const COOLDOWN_KEY_PREFIX = "admin:swarms:host-storage:";

/**
 * Swarms live under `*.sphinx.chat` (see the sibling `/cmd` route, which builds
 * `https://<name>.sphinx.chat`). Anything else is rejected before
 * authenticating — this is the SSRF guard that keeps a tampered `swarmUrl` DB
 * row from receiving our credentials or pointing us at internal infrastructure.
 */
const ALLOWED_SWARM_HOST_SUFFIXES = [".sphinx.chat"];

export type HostStorageReadOutcome =
  | "fresh"
  | "cached"
  | "unreachable"
  | "no_swarm_record"
  | "ambiguous"
  | "failed";

/**
 * Machine-readable failure/skip reasons. The read-failure codes are the
 * taxonomy from the ticket (`AUTH_FAILED`, `TIMEOUT`, `HTTP_<status>`,
 * `CONFIG_INVALID`, `DECRYPT_FAILED`, `MALFORMED`, `UNREACHABLE`); the lookup
 * and skip states are distinct typed outcomes of the resolution steps.
 */
export type HostStorageReadReasonCode =
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

export interface HostStorageReadResult {
  outcome: HostStorageReadOutcome;
  /** Normalised reading for `fresh` and `cached` outcomes. */
  reading?: HostStorageReading;
  /** Original swarm-side collection timestamp (unix seconds) for `fresh`/`cached`. */
  collectedAt?: number | null;
  reasonCode?: HostStorageReadReasonCode;
  /** True only when the reading was served from the Hive cooldown cache. */
  cached: boolean;
}

const encryptionService = EncryptionService.getInstance();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logFailure(swarmId: string | null, instanceId: string, reasonCode: HostStorageReadReasonCode): void {
  // Lookup-stage problems (no swarm row to attribute) warn; read failures error.
  const log = swarmId ? console.error : console.warn;
  if (swarmId) {
    log(`${LOG_PREFIX} failure swarmId=${swarmId} instance=${instanceId} reason=${reasonCode}`);
  } else {
    log(`${LOG_PREFIX} failure instance=${instanceId} reason=${reasonCode}`);
  }
}

function result(
  outcome: HostStorageReadOutcome,
  reasonCode: HostStorageReadReasonCode | undefined,
  swarmId: string | null,
  instanceId: string,
): HostStorageReadResult {
  if (reasonCode) logFailure(swarmId, instanceId, reasonCode);
  return { outcome, reasonCode, cached: false };
}

function isAbortErrorLike(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ABORT_ERR")
  );
}

/**
 * `decryptField` returns non-envelope strings unchanged (it swallows its own
 * parse errors), so the envelope shape is verified BEFORE calling it: a
 * plaintext or corrupt stored password must surface as DECRYPT_FAILED, never
 * become a normal-looking failed login against the swarm.
 */
function isEncryptedEnvelope(stored: string): boolean {
  try {
    return isEncrypted(JSON.parse(stored));
  } catch {
    return false;
  }
}

/** Parse a swarm URL from the DB row down to its hostname (http(s) only). */
function resolveSwarmHost(swarmUrl: string): string | null {
  try {
    const url = new URL(swarmUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname;
  } catch {
    return null;
  }
}

function isAllowedSwarmHost(hostname: string): boolean {
  return ALLOWED_SWARM_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

// ---------------------------------------------------------------------------
// Redis cooldown cache (last successful normalised reading per instanceId)
// ---------------------------------------------------------------------------

interface CooldownPayload {
  reading: HostStorageReading;
}

async function readCooldownCache(instanceId: string): Promise<HostStorageReadResult | null> {
  let raw: string | null;
  try {
    raw = await redis.get(COOLDOWN_KEY_PREFIX + instanceId);
  } catch {
    // The cooldown is an availability shield, not a correctness dependency:
    // a Redis outage degrades to a live read.
    console.warn(`${LOG_PREFIX} cooldown cache unavailable instance=${instanceId}`);
    return null;
  }
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw) as CooldownPayload;
    const reading = payload?.reading;
    // Only trustworthy cached shapes are served; anything else is a miss.
    if (
      reading &&
      (reading.status === "OK" || reading.status === "PARTIAL") &&
      typeof reading.collectedAt === "number"
    ) {
      return { outcome: "cached", reading, collectedAt: reading.collectedAt, cached: true };
    }
  } catch {
    // Corrupt entry — fall through to a live read.
  }
  return null;
}

async function writeCooldownCache(instanceId: string, reading: HostStorageReading): Promise<void> {
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

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Perform one live host-storage read for an EC2 instance. Never throws — every
 * failure is classified into the outcome discriminator.
 */
export async function readHostStorage(instanceId: string): Promise<HostStorageReadResult> {
  // 1. Input gate — before ANY DB query or cache lookup.
  if (!HOST_STORAGE_INSTANCE_ID_PATTERN.test(instanceId)) {
    return result("failed", "INVALID_INSTANCE_ID", null, instanceId);
  }

  // 2. Cooldown cache — inside the TTL there is no outbound call, no DB query
  //    and no credential decryption. The cached reading keeps its ORIGINAL
  //    collectedAt.
  const cached = await readCooldownCache(instanceId);
  if (cached) {
    console.log(`${LOG_PREFIX} cooldown hit instance=${instanceId}`);
    return cached;
  }

  // 3. Resolve the swarm — exactly one match, never an arbitrary pick.
  //    (`ec2Id` has no unique constraint and existing data is not verified
  //    clean, so >1 match is a distinct outcome, not a silent first-row read.)
  const swarms = await db.swarm.findMany({
    where: { ec2Id: instanceId },
    select: {
      id: true,
      swarmUrl: true,
      swarmPassword: true,
      workspace: { select: { deleted: true } },
    },
  });
  if (swarms.length === 0) {
    // A normal state: the admin swarms list is EC2-derived and tolerates
    // instances with no linked swarm record.
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

  // 5. Host allowlist. The URL comes from the DB row only — never caller
  //    input — and this check runs BEFORE authentication, because the login
  //    request transmits the swarm password to the resolved host.
  const hostname = resolveSwarmHost(swarm.swarmUrl);
  if (!hostname || !isAllowedSwarmHost(hostname)) {
    return result("failed", "CONFIG_INVALID", swarm.id, instanceId);
  }

  // 6. Credentials — DB path only.
  if (!isEncryptedEnvelope(swarm.swarmPassword)) {
    return result("failed", "DECRYPT_FAILED", swarm.id, instanceId);
  }
  let password: string;
  try {
    password = encryptionService.decryptField("swarmPassword", swarm.swarmPassword);
  } catch {
    return result("failed", "DECRYPT_FAILED", swarm.id, instanceId);
  }

  // 7. Login. getSwarmCmdJwt throws with the swarm's raw response text
  //    embedded — classified here and the message discarded, never logged.
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
    return result("failed", "AUTH_FAILED", swarm.id, instanceId);
  }

  // 8. Read + parse via the foundation ticket. `swarmCmdRequest` and
  //    `parseHostStorage` are composed directly rather than through
  //    `fetchHostStorage()` because the reason-code taxonomy (`TIMEOUT`,
  //    `HTTP_<status>`) needs the intermediate SwarmCmdResponse, which
  //    `fetchHostStorage` collapses into a generic UNREACHABLE reading. The
  //    command object is the server-side `GET_HOST_STORAGE_CMD` constant.
  let response: SwarmCmdResponse;
  try {
    response = await swarmCmdRequest({
      swarmUrl: swarm.swarmUrl,
      jwt,
      cmd: GET_HOST_STORAGE_CMD,
      timeoutMs: READ_TIMEOUT_MS,
    });
  } catch {
    // Non-abort transport failures (DNS, connection refused) throw out of
    // swarmCmdRequest; aborts resolve with errorCode TIMEOUT.
    return result("unreachable", "UNREACHABLE", swarm.id, instanceId);
  }

  const reading = parseHostStorage(response);

  if (reading.status === "OK" || reading.status === "PARTIAL") {
    await writeCooldownCache(instanceId, reading);
    return { outcome: "fresh", reading, collectedAt: reading.collectedAt, cached: false };
  }

  if (reading.status === "UNREACHABLE") {
    const reasonCode: HostStorageReadReasonCode =
      response.errorCode === "TIMEOUT"
        ? "TIMEOUT"
        : response.ok || response.status <= 0
          ? "UNREACHABLE"
          : `HTTP_${response.status}`;
    return result("unreachable", reasonCode, swarm.id, instanceId);
  }

  // ERROR: the swarm answered but the body is a stack_error or fails validation.
  return result(
    "failed",
    reading.reason === "STACK_ERROR" ? "STACK_ERROR" : "MALFORMED",
    swarm.id,
    instanceId,
  );
}
