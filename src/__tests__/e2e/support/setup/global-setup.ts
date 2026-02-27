import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

const WORKER_COUNT = 3;
const BASE_URL = process.env.DATABASE_URL!;

export default async function globalSetup() {
  for (let i = 0; i < WORKER_COUNT; i++) {
    const schemaName = `test_worker_${i}`;
    const schemaUrl = `${BASE_URL}?schema=${schemaName}`;

    const prisma = new PrismaClient({ datasources: { db: { url: BASE_URL } } });
    await prisma.$connect();
    
    // Drop existing schema if it exists to ensure clean state
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
    
    await prisma.$disconnect();

    // Use db push instead of migrate deploy for test schemas
    // This avoids issues with migrations that reference public schema enums
    execSync('npx prisma db push --skip-generate --accept-data-loss', {
      env: { ...process.env, DATABASE_URL: schemaUrl },
      stdio: 'inherit',
    });
  }
}
