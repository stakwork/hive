import { db } from '@/lib/db';

/**
 * Create a test screenshot with default values
 */
export async function createTestScreenshot(data: {
  workspaceId: string;
  taskId?: string;
  pageUrl?: string;
  s3Url?: string;
  urlExpiresAt?: Date;
}) {
  const screenshot = await db.screenshot.create({
    data: {
      workspaceId: data.workspaceId,
      taskId: data.taskId,
      s3Key: `test-key-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      s3Url: data.s3Url || 'https://test-url.s3.amazonaws.com/test.png',
      urlExpiresAt: data.urlExpiresAt || new Date(Date.now() + 86400000),
      hash: `hash-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      pageUrl: data.pageUrl || 'https://example.com',
      width: 1920,
      height: 1080,
      actionIndex: 0,
      timestamp: BigInt(Date.now()),
    },
  });
  return screenshot;
}
