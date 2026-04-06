import { db } from '@/lib/db';

export async function upsertTestPlatformConfig(key: string, value: string) {
  return db.platformConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}
