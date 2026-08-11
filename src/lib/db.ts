import { PrismaClient } from "@prisma/client";

const createPrismaClient = () =>
  new PrismaClient({
    // log: ["query"],
    log: ["info", "warn", "error"],
    // Global omit: these two fields are unreachable unless a query opts in with
    // an explicit `select`. Writes are NOT filtered by `omit`, so run creation
    // still persists webhookUrl normally.
    //
    // reportUrl — the run report bundle lives at a public, unsigned S3 URL, so
    //   the URL is a non-expiring bearer capability over converted legal source
    //   documents and agent transcripts. It must never reach a client.
    // webhookUrl — embeds the raw run_token HMAC in its query string (see
    //   legal/benchmarks/run/route.ts). Any workspace member who can read it
    //   can forge a token-valid ingest call for that run, which would collapse
    //   the run_token gate the whole ingest design rests on. Moving the token
    //   to a dedicated hashed column is the durable fix and is a follow-up.
    //
    // This is deliberately a global omit rather than a per-call-site select
    // sweep: there are ~39 non-test stakworkRun.find* sites, several with no
    // select at all, and an allowlist-by-omission is a permanent regression
    // surface. Omission-by-default makes exposure opt-in and greppable.
    omit: {
      stakworkRun: {
        reportUrl: true,
        webhookUrl: true,
      },
    },
  });

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
