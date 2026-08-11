import { PrismaClient } from "@prisma/client";

// The omit config makes reportUrl and webhookUrl unreachable from every default
// read so they cannot leak to clients.
// - reportUrl embeds a presigned S3 URL (short-lived capability)
// - webhookUrl embeds a raw HMAC run_token — leaking it collapses the run_token gate
// Both fields are opt-in via explicit select; writes are unaffected by omit.
//
// We cast both exports to PrismaClient (not typeof <instance>) deliberately:
// the Prisma omit generic resolves to a deeply-nested type that OOMs tsc during
// `next build` on memory-constrained CI runners. The runtime behaviour is
// identical — the omit config is applied when the instance is constructed, and
// the cast is safe because PrismaClient is a super-type of the omit-configured
// variant.
const dbInstance = new PrismaClient({
  log: ["info", "warn", "error"],
  omit: {
    stakworkRun: {
      reportUrl: true,
      webhookUrl: true,
    },
  },
}) as unknown as PrismaClient;

// A separate plain client is needed only for PrismaAdapter (NextAuth), which
// requires a standard PrismaClient with no omit configuration. It is not used
// anywhere else — callers should always use `db`.
const dbAdapterInstance = new PrismaClient({ log: ["info", "warn", "error"] });

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaAdapter: PrismaClient | undefined;
};

export const db: PrismaClient = globalForPrisma.prisma ?? dbInstance;

// Exported only for use by PrismaAdapter in src/lib/auth/nextauth.ts.
// Do not use this elsewhere — it bypasses the global field omit.
export const dbAdapter: PrismaClient =
  globalForPrisma.prismaAdapter ?? dbAdapterInstance;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
  globalForPrisma.prismaAdapter = dbAdapter;
}
