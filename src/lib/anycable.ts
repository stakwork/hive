import type { ActionCableConsumer } from "@anycable/web";

/**
 * What `cable.subscriptions.create()` hands back.
 *
 * Its teardown method is `unsubscribe()`. `disconnect()` belongs to the
 * underlying Channel (and to the consumer), NOT to the subscription — calling
 * it here throws at unmount and takes the whole React tree down with it.
 */
export type CableSubscription = ReturnType<
  ActionCableConsumer["subscriptions"]["create"]
>;

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
