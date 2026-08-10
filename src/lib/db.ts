import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
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

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
