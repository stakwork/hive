#!/bin/bash

# Resolve failed migrations: marks any known failed migration as rolled-back so Prisma can continue

echo "Resolving failed migration state..."

# Resolve the lightning_preauth migration that got stuck in a failed state
npx prisma migrate resolve --rolled-back 20260401103000_lightning_preauth

# Legacy: previous failed migration (kept for environments that haven't had it cleaned up)
npx prisma migrate resolve --rolled-back 20260301051356_add_voice_signature_to_user

echo "Migration state resolved. You can now run 'npx prisma migrate deploy' successfully."
