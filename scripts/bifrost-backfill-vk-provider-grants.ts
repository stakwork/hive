/**
 * One-shot: grant every Hive-provisioned Bifrost virtual key the
 * providers it is missing, on every workspace's gateway. "Missing" means
 * in DEFAULT_PROVIDERS, listed by that gateway's `GET /api/providers`,
 * and absent from the VK's provider_configs.
 *
 * Background: a VK reaches only the providers its provider_configs name.
 * Bifrost refuses any other provider with 403 `provider_blocked`, whatever
 * `allowed_models` the other entries carry. The reconciler tops up a
 * cached VK lazily, inside one of Hive's own LLM calls for that member,
 * once per 24h. A provider that no Hive model maps to (`openrouter-images`,
 * which only strut's image step calls) never triggers the 15-minute miss
 * refresh. A member who uses only strut is refreshed only when their strut
 * delegation is re-pushed (every 30–45 days), and a dormant member never
 * is. Run this after a gateway rollout adds a provider, so every member's
 * VK has it at once.
 *
 * Idempotent: a VK that already carries every provider its gateway offers
 * is left alone. Only VKs Hive provisioned for current members (a
 * `WorkspaceMember.bifrostVkId`, `leftAt: null`) are touched. Existing
 * grants are re-sent verbatim, ids and key grants included, by the
 * reconciler's own `topUpProviderGrants`. The VK's value does not change,
 * so the copy strut already holds keeps working.
 *
 * Stricter than the reconciler: a gateway whose provider list can't be
 * read is skipped, never granted the full default list (that PUT would
 * 400 on a gateway lacking one of them). This does not take the
 * reconciler's Redis lock. A lazy refresh landing in the same instant
 * could add the same grant twice, which grants nothing extra.
 *
 * Usage:
 *   npx tsx scripts/bifrost-backfill-vk-provider-grants.ts                   # dry run
 *   npx tsx scripts/bifrost-backfill-vk-provider-grants.ts --apply
 *   npx tsx scripts/bifrost-backfill-vk-provider-grants.ts --workspace=<id> --apply
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

interface MemberVk {
  memberId: string;
  vkId: string;
}

async function main() {
  const { apply, workspaceId } = parseArgs(process.argv.slice(2));

  // Imported after dotenv has run so DATABASE_URL / TOKEN_ENCRYPTION_KEY
  // are in place when these modules initialise.
  const { db } = await import("../src/lib/db");
  const { resolveBifrost } = await import("../src/services/bifrost/resolve");
  const { BifrostClient } = await import("../src/services/bifrost/BifrostClient");
  const { DEFAULT_PROVIDERS } = await import("../src/services/bifrost/constants");
  const { topUpProviderGrants } = await import("../src/services/bifrost/reconciler");

  const members = await db.workspaceMember.findMany({
    where: {
      bifrostVkId: { not: null },
      leftAt: null,
      ...(workspaceId ? { workspaceId } : {}),
    },
    select: { id: true, workspaceId: true, bifrostVkId: true },
  });
  const byWorkspace = new Map<string, MemberVk[]>();
  for (const m of members) {
    if (!m.bifrostVkId) continue;
    const list = byWorkspace.get(m.workspaceId) ?? [];
    list.push({ memberId: m.id, vkId: m.bifrostVkId });
    byWorkspace.set(m.workspaceId, list);
  }
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${members.length} VK(s) → ` + `${byWorkspace.size} workspace(s)`);

  const totals = {
    workspacesSkipped: 0,
    checked: 0,
    complete: 0,
    missing: 0,
    granted: 0,
    failed: 0,
  };

  for (const [wsId, vks] of byWorkspace) {
    let client: InstanceType<typeof BifrostClient>;
    let desired: typeof DEFAULT_PROVIDERS;
    try {
      client = new BifrostClient(await resolveBifrost(wsId));
      const { providers } = await client.listProviders();
      const configured = new Set(providers.map((p) => p.name));
      desired = DEFAULT_PROVIDERS.filter((p) => configured.has(p));
      const lacks = DEFAULT_PROVIDERS.filter((p) => !configured.has(p));
      console.log(
        `[${wsId}] gateway offers ${desired.join(", ") || "none"}` +
          (lacks.length ? ` (lacks ${lacks.join(", ")})` : ""),
      );
    } catch (err) {
      totals.workspacesSkipped++;
      console.warn(`[${wsId}] skipped (${vks.length} VK(s)): ${describe(err)}`);
      continue;
    }
    if (desired.length === 0) {
      totals.workspacesSkipped++;
      console.warn(`[${wsId}] skipped: gateway lists none of the default providers`);
      continue;
    }

    for (const { memberId, vkId } of vks) {
      totals.checked++;
      try {
        const { virtual_key } = await client.getVirtualKey(vkId);
        const have = new Set((virtual_key.provider_configs ?? []).map((pc) => pc.provider));
        const missing = desired.filter((p) => !have.has(p));
        if (missing.length === 0) {
          totals.complete++;
          continue;
        }
        totals.missing++;
        const line = `[${wsId}] ${virtual_key.name} (${vkId}): +${missing.join(", +")}`;
        if (!apply) {
          console.log(`would grant ${line}`);
          continue;
        }
        const { added, granted } = await topUpProviderGrants(client, virtual_key, desired);
        if (added.length === 0) {
          // topUpProviderGrants refuses a VK whose configs came back
          // without ids: a PUT without them would delete those grants.
          totals.failed++;
          console.warn(`[${wsId}] ${vkId} not granted: VK came back without hydrated provider_configs`);
          continue;
        }
        await db.workspaceMember.update({
          where: { id: memberId },
          data: {
            bifrostSyncedAt: new Date(),
            ...(granted ? { bifrostVkProviders: granted } : {}),
          },
        });
        totals.granted++;
        console.log(`granted     ${line}`);
      } catch (err) {
        totals.failed++;
        console.warn(`[${wsId}] ${vkId} failed: ${describe(err)}`);
      }
    }
  }

  console.log("");
  console.log(
    [
      `checked ${totals.checked}`,
      `complete ${totals.complete}`,
      `missing grants ${totals.missing}`,
      apply ? `granted ${totals.granted}` : `would grant ${totals.missing}`,
      `failed ${totals.failed}`,
      `workspaces skipped ${totals.workspacesSkipped}`,
    ].join(" · "),
  );
  if (!apply && totals.missing > 0) {
    console.log("Dry run — re-run with --apply to grant them.");
  }

  await db.$disconnect();
  if (totals.failed > 0 || totals.workspacesSkipped > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(describe(err));
  process.exit(1);
});
