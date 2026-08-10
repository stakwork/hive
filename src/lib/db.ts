import { PrismaClient } from "@prisma/client";

// Instantiate the clients first so we can use `typeof` for the global cache type.
const dbInstance = new PrismaClient({
  // log: ["query"],
  log: ["info", "warn", "error"],
  omit: {
    // reportUrl embeds a presigned S3 URL — a short-lived, expiring capability.
    // webhookUrl embeds a raw HMAC run_token in its query string — leaking it
    // to clients collapses the run_token gate the entire ingest design relies on.
    // Both fields are opt-in via explicit select; writes are unaffected by omit.
    stakworkRun: {
      reportUrl: true,
      webhookUrl: true,
    },
  },
});

// Plain client without omit — required for PrismaAdapter which expects a
// standard PrismaClient type with no omit configuration.
const dbAdapterInstance = new PrismaClient({ log: ["info", "warn", "error"] });

const globalForPrisma = globalThis as unknown as {
  prisma: typeof dbInstance | undefined;
  prismaAdapter: PrismaClient | undefined;
};

export const db: typeof dbInstance = globalForPrisma.prisma ?? dbInstance;

export const dbAdapter: PrismaClient =
  globalForPrisma.prismaAdapter ?? dbAdapterInstance;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
  globalForPrisma.prismaAdapter = dbAdapter;
}
