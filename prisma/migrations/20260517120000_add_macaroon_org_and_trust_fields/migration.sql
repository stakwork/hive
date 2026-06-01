-- Phase 5 (trust registry) — adds Hive-side state for:
--   1. per-org macaroon-signing keypair (custodial; phase-1 of
--      cryptographic-identity.md). Lives on SourceControlOrg, one
--      keypair per org, auto-generated on first LLM use.
--   2. per-swarm trust-reconcile cache. Content-addressed by
--      (orgId, pubkey); whenever the workspace's SourceControlOrg
--      values disagree with what's cached on the Swarm row, the next
--      LLM call re-syncs against the plugin's `/_plugin/trust` API.

-- AlterTable: SourceControlOrg
ALTER TABLE "source_control_orgs"
  ADD COLUMN IF NOT EXISTS "macaroon_org_id" TEXT,
  ADD COLUMN IF NOT EXISTS "macaroon_org_pubkey" TEXT,
  ADD COLUMN IF NOT EXISTS "macaroon_org_privkey" TEXT;

-- One macaroon_org_id per source-control org. Allows a future
-- "look up SourceControlOrg by macaroon org_id" path without a
-- table scan.
CREATE UNIQUE INDEX IF NOT EXISTS "source_control_orgs_macaroon_org_id_key"
  ON "source_control_orgs" ("macaroon_org_id");

-- AlterTable: Swarm — trust reconcile cache
ALTER TABLE "swarms"
  ADD COLUMN IF NOT EXISTS "bifrost_trusted_org_id" TEXT,
  ADD COLUMN IF NOT EXISTS "bifrost_trusted_pubkey" TEXT,
  ADD COLUMN IF NOT EXISTS "bifrost_trust_synced_at" TIMESTAMP(3);
