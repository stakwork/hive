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
    await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    await prisma.$disconnect();

    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: schemaUrl },
      stdio: 'inherit',
    });
  }
}
