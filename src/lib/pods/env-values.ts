import { db } from "@/lib/db";
import { decryptEnvVars } from "@/lib/encryption";

/**
 * Decrypts environment variables from their stored format.
 * Handles both string (JSON-encoded) and array formats with graceful fallback.
 */
export function decryptStoredEnvVars(environmentVariables: unknown): unknown {
  if (typeof environmentVariables === "string") {
    try {
      const parsed = JSON.parse(environmentVariables);
      if (!Array.isArray(parsed)) return parsed;
      try {
        return decryptEnvVars(parsed as Array<{ name: string; value: unknown }>);
      } catch {
        return parsed;
      }
    } catch {
      return environmentVariables;
    }
  }

  if (Array.isArray(environmentVariables)) {
    try {
      return decryptEnvVars(environmentVariables as Array<{ name: string; value: unknown }>);
    } catch {
      return environmentVariables;
    }
  }

  return environmentVariables;
}

/** Decrypts one EnvironmentVariable table row value (stored as an encrypted JSON string). */
export function decryptTableEnvValue(row: { name: string; value: string }): string {
  try {
    const decrypted = decryptEnvVars([{ name: row.name, value: JSON.parse(row.value) }]);
    return decrypted[0]?.value || "";
  } catch (error) {
    console.warn(`[Stakgraph] Failed to decrypt env var ${row.name}:`, error);
    // Fallback: try to use raw value if it's a string
    return typeof row.value === "string" ? row.value : "";
  }
}

/** Service-specific env vars (serviceName != "") grouped by service, decrypted. */
export async function loadServiceEnvMap(swarmId: string): Promise<Record<string, Record<string, string>>> {
  const rows = await db.environmentVariable.findMany({
    where: { swarmId, serviceName: { not: "" } },
    select: { serviceName: true, name: true, value: true },
  });
  const map: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    if (!row.serviceName) continue;
    (map[row.serviceName] ??= {})[row.name] = decryptTableEnvValue(row);
  }
  return map;
}

/** Global env vars from the table (serviceName == ""), decrypted, as name -> value. */
export async function loadGlobalTableEnv(swarmId: string): Promise<Record<string, string>> {
  const rows = await db.environmentVariable.findMany({
    where: { swarmId, serviceName: "" },
    select: { name: true, value: true },
  });
  return Object.fromEntries(rows.map((r) => [r.name, decryptTableEnvValue(r)]));
}

/** Stored global env values by name: the swarm JSON field wins, table rows fill the gaps. */
export function storedGlobalEnv(jsonField: unknown, tableEnv: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...tableEnv };
  const decrypted = decryptStoredEnvVars(jsonField);
  if (Array.isArray(decrypted)) {
    for (const v of decrypted as Array<{ name?: string; value?: unknown }>) {
      if (v?.name && typeof v.value === "string") out[v.name] = v.value;
    }
  }
  return out;
}

/** Prefixes a frontend toolchain ships to the browser bundle: public by construction. */
const PUBLIC_ENV_PREFIXES = ["NEXT_PUBLIC_", "PUBLIC_", "VITE_", "REACT_APP_", "EXPO_PUBLIC_", "NUXT_PUBLIC_"];
/** Plain runtime config, never a credential. */
const PUBLIC_ENV_NAMES = new Set(["NODE_ENV", "PORT", "HOST", "HOSTNAME"]);

/** An env var whose value is not a secret by its name alone — never redacted from pod output. */
export function isPublicEnvName(name: string): boolean {
  return PUBLIC_ENV_NAMES.has(name) || PUBLIC_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Every decrypted stored env var value of a swarm (global JSON field + table,
 * and per-service table rows), except those under a public name
 * (`isPublicEnvName`): redacting `NODE_ENV=production` or a `NEXT_PUBLIC_*`
 * URL would blank the very lines a repair agent reads. Used to redact
 * secrets from pod output.
 */
export async function loadAllStoredEnvValues(swarmId: string, jsonField: unknown): Promise<string[]> {
  const values = new Set<string>();
  const collect = (env: Record<string, string>) => {
    for (const [name, value] of Object.entries(env)) {
      if (!isPublicEnvName(name) && typeof value === "string" && value.length > 0) values.add(value);
    }
  };
  collect(storedGlobalEnv(jsonField, await loadGlobalTableEnv(swarmId)));
  for (const env of Object.values(await loadServiceEnvMap(swarmId))) collect(env);
  return Array.from(values);
}
