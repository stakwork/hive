import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Pool, PoolConfig } from "@neondatabase/serverless";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const isProduction = process.env.NODE_ENV === "production";
  
  // Use Neon serverless adapter in production
  if (isProduction && process.env.DATABASE_URL) {
    const connectionString = process.env.DATABASE_URL;
    const poolConfig: PoolConfig = { connectionString };
    const adapter = new PrismaNeon(poolConfig);
    
    return new PrismaClient({
      adapter,
      log: ["error"],
    });
  }
  
  // Use standard client for development
  return new PrismaClient({
    log: isProduction ? ["error"] : ["query", "error", "warn"],
  });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
