export type ImageVersion = {
  name: string;
  version: string;
  is_latest: boolean;
  latest_version: string;
};

const UNAVAILABLE = "unavailable";
const SPHINX_SUFFIX = ".sphinx";

/**
 * Joins Docker container names with GetAllImageActualVersion keys.
 *
 * Order: strip a single leading `/`, then a trailing `.sphinx` suffix once,
 * then alias the exact token `sphinx-swarm` → `swarm`.
 */
export function normalizeServiceName(name: string): string {
  let result = name.startsWith("/") ? name.slice(1) : name;
  if (result.endsWith(SPHINX_SUFFIX)) {
    result = result.slice(0, -SPHINX_SUFFIX.length);
  }
  if (result === "sphinx-swarm") return "swarm";
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toImageVersion(item: unknown): ImageVersion | null {
  if (!isRecord(item)) return null;
  if (typeof item.name !== "string" || item.name.length === 0) return null;

  return {
    name: item.name,
    version: typeof item.version === "string" ? item.version : "",
    is_latest: typeof item.is_latest === "boolean" ? item.is_latest : true,
    latest_version: typeof item.latest_version === "string" ? item.latest_version : "",
  };
}

/**
 * Parses a sphinx-swarm `GetAllImageActualVersion` body into a name → version map.
 *
 * Accepts `{ success, message, data: ImageVersion[] }` or a bare `ImageVersion[]`.
 * Name-keyed records and the legacy `{ images: { name: tag } }` shape are unsupported
 * and produce an empty map.
 */
export function parseImageVersions(raw: unknown): Map<string, ImageVersion> {
  const map = new Map<string, ImageVersion>();

  let items: unknown[] | null = null;
  if (Array.isArray(raw)) {
    items = raw;
  } else if (isRecord(raw) && Array.isArray(raw.data)) {
    items = raw.data;
  }

  if (!items) return map;

  for (const item of items) {
    const version = toImageVersion(item);
    if (!version) continue;
    const key = normalizeServiceName(version.name);
    if (key.length === 0) continue;
    map.set(key, version);
  }

  return map;
}

/**
 * sphinx-swarm `determineIfShouldUpdate`: both version fields known and not the
 * `"unavailable"` sentinel, and `is_latest` is falsy.
 */
export function shouldShowUpdateAvailable(
  v: ImageVersion | undefined | null
): boolean {
  if (!v) return false;
  if (typeof v.version !== "string" || typeof v.latest_version !== "string") {
    return false;
  }
  if (v.version.length === 0 || v.latest_version.length === 0) return false;
  if (v.version === UNAVAILABLE || v.latest_version === UNAVAILABLE) return false;
  return !v.is_latest;
}
