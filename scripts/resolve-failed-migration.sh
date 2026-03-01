#!/bin/bash

# Resolve failed migration: 20260301051356_add_voice_signature_to_user
# This script marks the failed duplicate migration as rolled back so Prisma can continue

echo "Resolving failed migration state..."

# Mark the failed migration as rolled back in the _prisma_migrations table
# This allows Prisma to continue with future migrations
npx prisma migrate resolve --rolled-back 20260301051356_add_voice_signature_to_user

echo "Migration state resolved. You can now run 'npx prisma migrate deploy' successfully."
