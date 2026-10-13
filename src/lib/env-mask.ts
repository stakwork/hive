/**
 * Masking of env var values for token (non-session) callers, matching the
 * pool manager's `_mask_value` style, plus the inverse "unmask on write" logic.
 */

export function maskEnvValue(value: string): string {
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}${"*".repeat(Math.max(value.length - 4, 4))}${value.slice(-2)}`;
}

export interface EnvVar {
  name: string;
  value: string;
}

/** Mask the values of a list of env vars, keeping names. */
export function maskEnvVarList<T extends EnvVar>(vars: T[]): T[] {
  return vars.map((v) => ({ ...v, value: typeof v.value === "string" ? maskEnvValue(v.value) : v.value }));
}

/** Mask the values of a name -> value env map, keeping names. */
export function maskEnvMap(env: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env ?? {}).map(([k, v]) => [k, typeof v === "string" ? maskEnvValue(v) : v]),
  );
}

/**
 * If `incoming` is exactly the mask of the stored value for the same name,
 * the caller sent back what it read: keep the stored value. Anything else
 * (changed or unknown name) is taken as sent.
 */
export function unmaskValue(incoming: string, stored: string | undefined): string {
  return stored !== undefined && incoming === maskEnvValue(stored) ? stored : incoming;
}

export function unmaskEnvVarList<T extends EnvVar>(incoming: T[], stored: Record<string, string>): T[] {
  return incoming.map((v) => ({ ...v, value: unmaskValue(v.value, stored[v.name]) }));
}

/**
 * Restore each service's env against what is stored under that service name:
 * masked values sent back unchanged map to the stored value, and a service
 * sent without `env` keeps its stored env (send `env: {}` to clear it).
 */
export function unmaskServiceEnvs<T extends { name: string; env?: Record<string, string> }>(
  services: T[],
  storedByService: Record<string, Record<string, string>>,
): T[] {
  return services.map((s) => {
    const stored = storedByService[s.name];
    if (!s.env) return stored ? { ...s, env: { ...stored } } : s;
    return {
      ...s,
      env: Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, unmaskValue(v, stored?.[k])])),
    };
  });
}
