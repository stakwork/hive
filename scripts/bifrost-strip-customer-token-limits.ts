/**
 * One-shot: strip the token-per-minute rate limit from every Bifrost
 * Customer Hive has provisioned, on every workspace's gateway.
 *
 * Background: Customers were created with `token_max_limit: 5_000_000`
 * per minute. Bifrost counts cached prompt tokens against it in full,
 * so one user's parallel agents tripped it on ordinary use
 * (`rate limit violated for customer …: token limit exceeded`).
 * `DEFAULT_CUSTOMER_RATE_LIMIT` no longer sets a token cap and the
 * reconciler strips a leftover one lazily — once per member per 24h
 * refresh window, on that member's next LLM call. This script does it
 * for every provisioned Customer right now, dormant members included,
 * without waiting for a deploy.
 *
 * Idempotent: a Customer without a token limit is left alone. Only
 * Customers Hive provisioned (a `WorkspaceMember.bifrostCustomerId`)
 * are touched, never ones an operator created by hand. Each Customer's
 * request limit is kept verbatim; only the token fields go.
 *
 * Usage:
 *   npx tsx scripts/bifrost-strip-customer-token-limits.ts                   # dry run
 *   npx tsx scripts/bifrost-strip-customer-token-limits.ts --apply
 *   npx tsx scripts/bifrost-strip-customer-token-limits.ts --workspace=<id> --apply
 *
 * Needs DATABASE_URL and TOKEN_ENCRYPTION_KEY (the swarm's Bifrost
 * admin password is encrypted at rest) and network reach to each
 * swarm's gateway on :8181. Reads .env.local like the other scripts.
 */

import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });

interface Args {
  apply: boolean;
  workspaceId?: string;
}

function parseArgs(argv: string[]): Args {
  const apply = argv.includes("--apply");
  const ws = argv.find((a) => a.startsWith("--workspace="));
  return {
    apply,
    workspaceId: ws?.slice("--workspace=".length) || undefined,
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main() {
  const { apply, workspaceId } = parseArgs(process.argv.slice(2));

  // Imported after dotenv has run so DATABASE_URL / TOKEN_ENCRYPTION_KEY
  // are in place when these modules initialise.
  const { db } = await import("../src/lib/db");
  const { resolveBifrost } = await import("../src/services/bifrost/resolve");
  const { BifrostClient } = await import(
    "../src/services/bifrost/BifrostClient"
  );
  const { hasTokenLimit, stripCustomerTokenLimit } = await import(
    "../src/services/bifrost/customer-rate-limit"
  );

  // Every Customer Hive ever provisioned, current and departed members
  // alike — a departed member's Customer is still Hive's to repair.
  const members = await db.workspaceMember.findMany({
    where: {
      bifrostCustomerId: { not: null },
      ...(workspaceId ? { workspaceId } : {}),
    },
    select: { workspaceId: true, bifrostCustomerId: true },
  });
  const byWorkspace = new Map<string, Set<string>>();
  for (const m of members) {
    if (!m.bifrostCustomerId) continue;
    const set = byWorkspace.get(m.workspaceId) ?? new Set<string>();
    set.add(m.bifrostCustomerId);
    byWorkspace.set(m.workspaceId, set);
  }
  console.log(
    `${apply ? "APPLY" : "DRY RUN"}: ${members.length} member row(s) → ` +
      `${byWorkspace.size} workspace(s)`,
  );

  const totals = {
    workspacesSkipped: 0,
    checked: 0,
    clean: 0,
    capped: 0,
    stripped: 0,
    failed: 0,
  };

  for (const [wsId, customerIds] of byWorkspace) {
    let client: InstanceType<typeof BifrostClient>;
    try {
      client = new BifrostClient(await resolveBifrost(wsId));
    } catch (err) {
      totals.workspacesSkipped++;
      console.warn(`[${wsId}] skipped (${customerIds.size} customer(s)): ${describe(err)}`);
      continue;
    }

    for (const customerId of customerIds) {
      totals.checked++;
      try {
        const { customer } = await client.getCustomer(customerId);
        if (!hasTokenLimit(customer)) {
          totals.clean++;
          continue;
        }
        totals.capped++;
        const rl = customer.rate_limit ?? {};
        const line =
          `[${wsId}] ${customer.name} (${customerId}): ` +
          `tokens ${rl.token_max_limit}/${rl.token_reset_duration ?? "?"}, ` +
          `requests ${rl.request_max_limit ?? "-"}/${rl.request_reset_duration ?? "-"}`;
        if (!apply) {
          console.log(`would strip ${line}`);
          continue;
        }
        await stripCustomerTokenLimit(client, customer);
        totals.stripped++;
        console.log(`stripped    ${line}`);
      } catch (err) {
        totals.failed++;
        console.warn(`[${wsId}] ${customerId} failed: ${describe(err)}`);
      }
    }
  }

  console.log("");
  console.log(
    [
      `checked ${totals.checked}`,
      `clean ${totals.clean}`,
      `capped ${totals.capped}`,
      apply ? `stripped ${totals.stripped}` : `would strip ${totals.capped}`,
      `failed ${totals.failed}`,
      `workspaces skipped ${totals.workspacesSkipped}`,
    ].join(" · "),
  );
  if (!apply && totals.capped > 0) {
    console.log("Dry run — re-run with --apply to strip them.");
  }

  await db.$disconnect();
  if (totals.failed > 0 || totals.workspacesSkipped > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(describe(err));
  process.exit(1);
});
