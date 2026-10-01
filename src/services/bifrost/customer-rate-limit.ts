import { logger } from "@/lib/logger";

import type { BifrostClient } from "./BifrostClient";
import { BIFROST_LOG_TAG } from "./constants";
import type { BifrostCustomer, BifrostRateLimit } from "./types";

/**
 * Customer rate-limit repair.
 *
 * Customers minted before `DEFAULT_CUSTOMER_RATE_LIMIT` dropped the
 * token-per-minute cap still carry `token_max_limit: 5_000_000` — and
 * Hive never updated a Customer after creating it, so the cap outlived
 * the constant. The reconciler strips it lazily: on the create/miss
 * path, where `ensureCustomer` already holds the Customer, and on the
 * cached path once per refresh window alongside the provider-grant
 * re-check. One PUT per Customer, ever — once the token fields are gone
 * there is nothing left to strip.
 * `scripts/bifrost-strip-customer-token-limits.ts` does the same for
 * every provisioned Customer at once.
 */

/** True when the Customer still carries a token-per-window cap. */
export function hasTokenLimit(customer: BifrostCustomer): boolean {
  return customer.rate_limit?.token_max_limit != null;
}

/**
 * Drop the token limit from `customer`'s rate limit, keeping its
 * request limit verbatim. Returns the Customer as Bifrost reports it
 * afterwards (or the input, untouched, when there was nothing to
 * strip) and whether a PUT was made. Throws on a Bifrost error —
 * callers on the LLM path wrap it (see the reconciler), the script
 * reports it.
 *
 * Bifrost's `PUT customers/<id>` replaces all four rate-limit fields,
 * so the request fields are re-sent and the token fields left out. A
 * Customer whose only limit was the token one is sent `rate_limit: {}`,
 * which Bifrost treats as "remove the rate limit" — the intent.
 *
 * A list row whose `rate_limit` wasn't hydrated but points at one via
 * `rate_limit_id` is read back first, so the decision is made on real
 * data rather than an absent field.
 */
export async function stripCustomerTokenLimit(
  client: BifrostClient,
  customer: BifrostCustomer,
): Promise<{ customer: BifrostCustomer; stripped: boolean }> {
  let current = customer;
  if (current.rate_limit === undefined && current.rate_limit_id) {
    current = (await client.getCustomer(current.id)).customer;
  }
  if (!hasTokenLimit(current)) return { customer: current, stripped: false };

  const was = current.rate_limit ?? {};
  const kept: BifrostRateLimit = {};
  if (was.request_max_limit != null) {
    kept.request_max_limit = was.request_max_limit;
  }
  if (was.request_reset_duration != null) {
    kept.request_reset_duration = was.request_reset_duration;
  }

  const { customer: updated } = await client.updateCustomer(current.id, {
    rate_limit: kept,
  });
  logger.info("Bifrost Customer token limit stripped", BIFROST_LOG_TAG, {
    customerId: current.id,
    name: current.name,
    tokenMaxLimit: was.token_max_limit,
    tokenResetDuration: was.token_reset_duration,
    kept,
  });
  return { customer: updated ?? current, stripped: true };
}
