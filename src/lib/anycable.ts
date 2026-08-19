/**
 * Returns the AnyCable WebSocket URL for the given Rails environment.
 *
 * Contract: only the exact string "production" maps to the jobs (production)
 * host. Any other value — including near-misses like "prod" — maps to the
 * staging host. An unset or empty NEXT_PUBLIC_RAILS_ENV falls through the
 * call sites' `|| "production"` default and therefore also resolves to the
 * production host, NOT staging.
 */
export function cableUrl(railsEnv: string): string {
  return railsEnv === "production"
    ? "wss://jobs.stakwork.com/cable"
    : "wss://staging.stakwork.com/cable";
}
