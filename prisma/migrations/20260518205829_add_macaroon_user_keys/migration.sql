-- Phase 4 (macaroon user identity) — adds Hive-side state for each
-- user's macaroon-signing ed25519 keypair. Custodial in phase 1:
-- privkey lives encrypted in the DB, Hive signs `invocation` layers
-- on the user's behalf. Phase 2+ migrates the privkey off the
-- platform (Yubikey / Passkey / Sphinx app) — at that point
-- `macaroon_user_privkey` goes null while the pubkey stays.
--
-- The pubkey is what the org's macaroon-signing key binds in the
-- `user_authorization` envelope (see `gateway/auth/ts` / `gatekey`
-- package). One keypair per user, regardless of how many workspaces
-- or orgs that user belongs to.

-- AlterTable: User
ALTER TABLE "users"
  ADD COLUMN "macaroon_user_pubkey" TEXT,
  ADD COLUMN "macaroon_user_privkey" TEXT;
