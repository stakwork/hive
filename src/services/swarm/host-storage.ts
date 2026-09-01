import { z } from "zod";
import { swarmCmdRequest, type SwarmCmd, type SwarmCmdResponse } from "./cmd";

/**
 * Host storage telemetry (GetHostStorage).
 *
 * The swarm-side command does not exist yet — the response shape is a PROPOSED
 * contract pinned in `__fixtures__/host-storage.contract.json`. That fixture is
 * the only place these external field names may appear outside this parser;
 * when the real sphinx-swarm contract lands, reconciling is: update the
 * fixture, update the schema below, re-run the parser tests.
 *
 * Never fabricate a number: unknown sizes map to null, never 0.
 */

/** Outbound command, built server-side from this constant only — never from request input. */
export const GET_HOST_STORAGE_CMD: SwarmCmd = {
  type: "Swarm",
  data: { cmd: "GetHostStorage" },
};

export type HostStorageStatus = "OK" | "PARTIAL" | "ERROR" | "UNREACHABLE";

export type HostStorageSource = "node_exporter" | "container_bind" | "none";

/** Machine-readable reason when status is ERROR or UNREACHABLE. */
export type HostStorageFailureReason = "STACK_ERROR" | "MALFORMED" | "UNREACHABLE";

const MAX_ARRAY_ENTRIES = 64;
const MAX_STRING_LENGTH = 256;

const capString = (value: string) => value.slice(0, MAX_STRING_LENGTH);
const capArray = <T>(items: T[]) => items.slice(0, MAX_ARRAY_ENTRIES);

const byteCount = z.number().int();
const cappedString = z.string().transform(capString);

const contractFilesystemSchema = z.object({
  mount: cappedString,
  device: cappedString,
  fstype: cappedString,
  total_bytes: byteCount,
  used_bytes: byteCount,
  free_bytes: byteCount,
  describes_host: z.boolean(),
});

const contractVolumeSchema = z.object({
  name: cappedString,
  size_bytes: byteCount,
  size_known: z.boolean(),
});

const contractNeo4jSchema = z.object({
  volumes: z.array(cappedString).transform(capArray),
  size_bytes: byteCount,
  size_known: z.boolean(),
});

const contractErrorSchema = z.object({
  collector: cappedString,
  reason: cappedString,
});

export const hostStorageSchema = z.object({
  host_visible: z.boolean(),
  source: z.enum(["node_exporter", "container_bind", "none"]),
  collected_at: z.number().int(),
  cached: z.boolean(),
  filesystems: z.array(contractFilesystemSchema).transform(capArray),
  docker_root_dir: cappedString,
  docker_root_filesystem: cappedString,
  volumes: z.array(contractVolumeSchema).transform(capArray),
  neo4j: z.nullable(contractNeo4jSchema),
  errors: z.array(contractErrorSchema).transform(capArray),
});

/** Wire shape of the pinned contract fixture. */
export type HostStorageContract = z.infer<typeof hostStorageSchema>;

// ---------------------------------------------------------------------------
// Normalised reading (whitelisted fields only — never the raw body)
// ---------------------------------------------------------------------------

export interface HostStorageFilesystem {
  mount: string;
  device: string;
  fstype: string;
  totalBytes: number | null;
  usedBytes: number | null;
  freeBytes: number | null;
  describesHost: boolean;
}

export interface HostStorageVolume {
  name: string;
  sizeBytes: number | null;
  sizeKnown: boolean;
}

export interface HostStorageNeo4j {
  volumes: string[];
  sizeBytes: number | null;
  sizeKnown: boolean;
}

export interface HostStorageError {
  collector: string;
  reason: string;
}

export interface HostStorageReading {
  status: HostStorageStatus;
  /** Only set when status is ERROR or UNREACHABLE. */
  reason?: HostStorageFailureReason;
  hostVisible: boolean;
  source: HostStorageSource;
  collectedAt: number | null;
  cached: boolean;
  filesystems: HostStorageFilesystem[];
  dockerRootDir: string;
  dockerRootFilesystem: string;
  /** Filesystem whose mount matches `docker_root_filesystem`; null when unresolved. */
  governingFilesystem: HostStorageFilesystem | null;
  volumes: HostStorageVolume[];
  neo4j: HostStorageNeo4j | null;
  errors: HostStorageError[];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Filesystem bytes: -1 (or any negative) means "could not be measured", never 0. */
function fsBytes(value: number): number | null {
  return value >= 0 ? value : null;
}

/** Volume/neo4j bytes: unknown when `size_known` is false or the sentinel -1 is used. */
function sizeBytes(value: number, sizeKnown: boolean): number | null {
  return sizeKnown && value >= 0 ? value : null;
}

function normalizeFilesystem(fs: HostStorageContract["filesystems"][number]): HostStorageFilesystem {
  return {
    mount: fs.mount,
    device: fs.device,
    fstype: fs.fstype,
    totalBytes: fsBytes(fs.total_bytes),
    usedBytes: fsBytes(fs.used_bytes),
    freeBytes: fsBytes(fs.free_bytes),
    describesHost: fs.describes_host,
  };
}

function normalizeVolume(volume: HostStorageContract["volumes"][number]): HostStorageVolume {
  return {
    name: volume.name,
    sizeBytes: sizeBytes(volume.size_bytes, volume.size_known),
    sizeKnown: volume.size_known,
  };
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
  reason: HostStorageFailureReason,
): HostStorageReading {
  return {
    status,
    reason,
    hostVisible: false,
    source: "none",
    collectedAt: null,
    cached: false,
    filesystems: [],
    dockerRootDir: "",
    dockerRootFilesystem: "",
    governingFilesystem: null,
    volumes: [],
    neo4j: null,
    errors: [],
  };
}

/**
 * Normalise a GetHostStorage response into a whitelisted reading.
 *
 * Status classification (explicit rule — parser and UI cannot drift):
 * - OK          well-formed body, no errors[], governing filesystem resolved
 * - PARTIAL     well-formed body with non-empty errors[] or unresolved governing FS
 * - ERROR       body carries stack_error, or fails validation (MALFORMED)
 * - UNREACHABLE no usable body (timeout, DNS, connection refused, non-2xx)
 */
export function parseHostStorage(response: SwarmCmdResponse): HostStorageReading {
  const body = response.data;

  // Transport-level failure reported by the swarm itself.
  if (isStackErrorBody(body)) {
    return failureReading("ERROR", "STACK_ERROR");
  }

  // No usable body at all.
  if (body === undefined || body === null) {
    return response.ok
      ? failureReading("ERROR", "MALFORMED")
      : failureReading("UNREACHABLE", "UNREACHABLE");
  }

  // Non-2xx with a body that is not a stack_error: the swarm was not reachable
  // for a reading, whatever it sent back.
  if (!response.ok) {
    return failureReading("UNREACHABLE", "UNREACHABLE");
  }

  // Validate before anything else — the body is attacker-shaped input.
  const parsed = hostStorageSchema.safeParse(body);
  if (!parsed.success) {
    return failureReading("ERROR", "MALFORMED");
  }
  const contract = parsed.data;

  const filesystems = contract.filesystems.map(normalizeFilesystem);
  const volumes = contract.volumes.map(normalizeVolume);
  const neo4j: HostStorageNeo4j | null = contract.neo4j
    ? {
        volumes: contract.neo4j.volumes,
        sizeBytes: sizeBytes(contract.neo4j.size_bytes, contract.neo4j.size_known),
        sizeKnown: contract.neo4j.size_known,
      }
    : null;

  // host_visible is derived from the filesystem entries, not trusted from the body.
  const hostVisible = contract.filesystems.some((fs) => fs.describes_host);

  // Governing filesystem: exact mount match. Never fall back to the first entry.
  const governingFilesystem =
    filesystems.find((fs) => fs.mount === contract.docker_root_filesystem) ?? null;

  const errors: HostStorageError[] = contract.errors.map((e) => ({
    collector: e.collector,
    reason: e.reason,
  }));
  if (!governingFilesystem) {
    // Reserve the last slot for the synthetic error so it always survives capping.
    if (errors.length > MAX_ARRAY_ENTRIES - 1) {
      errors.length = MAX_ARRAY_ENTRIES - 1;
    }
    errors.push({ collector: "host_storage", reason: "governing filesystem not found" });
  } else if (errors.length > MAX_ARRAY_ENTRIES) {
    errors.length = MAX_ARRAY_ENTRIES;
  }

  const status: HostStorageStatus = errors.length > 0 ? "PARTIAL" : "OK";

  return {
    status,
    hostVisible,
    source: contract.source,
    collectedAt: contract.collected_at,
    cached: contract.cached,
    filesystems,
    dockerRootDir: contract.docker_root_dir,
    dockerRootFilesystem: contract.docker_root_filesystem,
    governingFilesystem,
    volumes,
    neo4j,
    errors,
  };
}

/**
 * Fetch host storage from a swarm and return the normalised reading.
 *
 * The outbound command is built from the `GET_HOST_STORAGE_CMD` constant only —
 * no part of it is ever assembled from request input. Transport-level failures
 * (DNS, connection refused, timeout) resolve as UNREACHABLE readings; this
 * function never throws.
 */
export async function fetchHostStorage(
  swarmUrl: string,
  jwt: string,
  options: { timeoutMs?: number } = {},
): Promise<HostStorageReading> {
  let response: SwarmCmdResponse;
  try {
    response = await swarmCmdRequest({
      swarmUrl,
      jwt,
      cmd: GET_HOST_STORAGE_CMD,
      timeoutMs: options.timeoutMs,
    });
  } catch {
    // swarmCmdRequest throws only on transport-level failures; those are
    // unreachable readings, not parser failures.
    return failureReading("UNREACHABLE", "UNREACHABLE");
  }
  return parseHostStorage(response);
}
