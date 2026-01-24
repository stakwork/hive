import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const prismaBase =
  globalForPrisma.prisma ??
  new PrismaClient({
    // log: ["query"],
    log: ["info", "warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prismaBase;

// Prisma Client Extension for soft-delete filtering on Pod queries
export const db = prismaBase.$extends({
  query: {
    pod: {
      async findMany({ args, query }) {
        // Only inject deletedAt: null if it's not already explicitly specified
        if (!args.where || !("deletedAt" in (args.where as any))) {
          args.where = {
            ...args.where,
            deletedAt: null,
          };
        }
        return query(args);
      },
      async findFirst({ args, query }) {
        // Only inject deletedAt: null if it's not already explicitly specified
        if (!args.where || !("deletedAt" in (args.where as any))) {
          args.where = {
            ...args.where,
            deletedAt: null,
          };
        }
        return query(args);
      },
      async findUnique({ args, query }) {
        // Only inject deletedAt: null if it's not already explicitly specified
        if (!args.where || !("deletedAt" in (args.where as any))) {
          args.where = {
            ...args.where,
            deletedAt: null,
          };
        }
        return query(args);
      },
    },
    // Handle nested pod queries from other models (e.g., Swarm.include.pods)
    swarm: {
      async findUnique({ args, query }) {
        if (args.include?.pods) {
          if (typeof args.include.pods === "boolean") {
            args.include.pods = {
              where: { deletedAt: null },
            };
          } else if (
            typeof args.include.pods === "object" &&
            (!args.include.pods.where || !("deletedAt" in args.include.pods.where))
          ) {
            args.include.pods = {
              ...args.include.pods,
              where: {
                ...args.include.pods.where,
                deletedAt: null,
              },
            };
          }
        }
        return query(args);
      },
      async findFirst({ args, query }) {
        if (args.include?.pods) {
          if (typeof args.include.pods === "boolean") {
            args.include.pods = {
              where: { deletedAt: null },
            };
          } else if (
            typeof args.include.pods === "object" &&
            (!args.include.pods.where || !("deletedAt" in args.include.pods.where))
          ) {
            args.include.pods = {
              ...args.include.pods,
              where: {
                ...args.include.pods.where,
                deletedAt: null,
              },
            };
          }
        }
        return query(args);
      },
      async findMany({ args, query }) {
        if (args.include?.pods) {
          if (typeof args.include.pods === "boolean") {
            args.include.pods = {
              where: { deletedAt: null },
            };
          } else if (
            typeof args.include.pods === "object" &&
            (!args.include.pods.where || !("deletedAt" in args.include.pods.where))
          ) {
            args.include.pods = {
              ...args.include.pods,
              where: {
                ...args.include.pods.where,
                deletedAt: null,
              },
            };
          }
        }
        return query(args);
      },
    },
  },
});
