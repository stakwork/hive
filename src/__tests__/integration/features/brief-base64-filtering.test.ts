import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { createTestWorkspace, createTestUser } from '@/__tests__/support/factories';

describe('Brief Base64 Filtering Integration', () => {
  let userId: string;
  let workspaceId: string;
  let featureId: string;

  beforeEach(async () => {
    // Create test user
    const user = await createTestUser({
      email: 'test@example.com',
      name: 'Test User',
    });
    userId = user.id;

    // Create test workspace
    const workspace = await createTestWorkspace({
      name: 'Test Workspace',
      slug: 'test-workspace',
      ownerId: userId,
    });
    workspaceId = workspace.id;

    // Create test feature with base64 in brief
    const feature = await db.feature.create({
      data: {
        title: 'Test Feature',
        brief: 'Bug report with screenshot: ![screenshot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)',
        workspaceId,
        createdById: userId,
        updatedById: userId,
      },
    });
    featureId = feature.id;
  });

  it('should retrieve feature with base64 in brief from database', async () => {
    const feature = await db.feature.findUnique({
      where: { id: featureId },
    });

    expect(feature).toBeDefined();
    expect(feature?.brief).toContain('data:image/png;base64');
  });

  it('should preserve base64 data when updating feature brief text', async () => {
    // Update the feature brief (simulating user editing text)
    const updatedBrief = 'Updated text: ![screenshot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==) more text';
    
    await db.feature.update({
      where: { id: featureId },
      data: { brief: updatedBrief },
    });

    const feature = await db.feature.findUnique({
      where: { id: featureId },
    });

    expect(feature?.brief).toBe(updatedBrief);
    expect(feature?.brief).toContain('data:image/png;base64');
    expect(feature?.brief).toContain('Updated text');
  });

  it('should handle feature with multiple base64 images in brief', async () => {
    const briefWithMultipleImages = `
      First image: ![img1](data:image/png;base64,ABC123)
      Some text here.
      Second image: ![img2](data:image/jpeg;base64,XYZ789)
    `;

    await db.feature.update({
      where: { id: featureId },
      data: { brief: briefWithMultipleImages },
    });

    const feature = await db.feature.findUnique({
      where: { id: featureId },
    });

    expect(feature?.brief).toContain('data:image/png;base64,ABC123');
    expect(feature?.brief).toContain('data:image/jpeg;base64,XYZ789');
  });

  it('should handle feature with mixed S3 URLs and base64 images', async () => {
    const mixedContent = `
      S3 image: ![s3img](https://s3.amazonaws.com/bucket/image.png)
      Base64 image: ![b64img](data:image/png;base64,ABC123)
    `;

    await db.feature.update({
      where: { id: featureId },
      data: { brief: mixedContent },
    });

    const feature = await db.feature.findUnique({
      where: { id: featureId },
    });

    expect(feature?.brief).toContain('https://s3.amazonaws.com/bucket/image.png');
    expect(feature?.brief).toContain('data:image/png;base64,ABC123');
  });

  it('should handle feature with no images in brief', async () => {
    const plainTextBrief = 'This is just plain text without any images.';

    await db.feature.update({
      where: { id: featureId },
      data: { brief: plainTextBrief },
    });

    const feature = await db.feature.findUnique({
      where: { id: featureId },
    });

    expect(feature?.brief).toBe(plainTextBrief);
  });

  it('should handle null brief value', async () => {
    await db.feature.update({
      where: { id: featureId },
      data: { brief: null },
    });

    const feature = await db.feature.findUnique({
      where: { id: featureId },
    });

    expect(feature?.brief).toBeNull();
  });

  it('should preserve base64 data through multiple updates', async () => {
    const originalBrief = '![img](data:image/png;base64,ORIGINAL123)';
    
    // First update
    await db.feature.update({
      where: { id: featureId },
      data: { brief: originalBrief },
    });

    let feature = await db.feature.findUnique({
      where: { id: featureId },
    });

    expect(feature?.brief).toContain('ORIGINAL123');

    // Second update (user adds text)
    const updatedBrief = 'Added text. ' + originalBrief;
    
    await db.feature.update({
      where: { id: featureId },
      data: { brief: updatedBrief },
    });

    feature = await db.feature.findUnique({
      where: { id: featureId },
    });

    expect(feature?.brief).toContain('ORIGINAL123');
    expect(feature?.brief).toContain('Added text.');
  });

  it('should handle very long base64 strings', async () => {
    // Simulate a realistic base64 string (much longer)
    const longBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='.repeat(10);
    const briefWithLongBase64 = `![screenshot](data:image/png;base64,${longBase64})`;

    await db.feature.update({
      where: { id: featureId },
      data: { brief: briefWithLongBase64 },
    });

    const feature = await db.feature.findUnique({
      where: { id: featureId },
    });

    expect(feature?.brief).toContain('data:image/png;base64');
    expect(feature?.brief).toContain(longBase64);
    expect(feature?.brief?.length).toBeGreaterThan(900); // Verify substantial length is preserved
  });

  it('should handle different image formats in base64', async () => {
    const multiFormatBrief = `
      PNG: ![png](data:image/png;base64,PNG123)
      JPEG: ![jpeg](data:image/jpeg;base64,JPEG456)
      WebP: ![webp](data:image/webp;base64,WEBP789)
      GIF: ![gif](data:image/gif;base64,GIF012)
    `;

    await db.feature.update({
      where: { id: featureId },
      data: { brief: multiFormatBrief },
    });

    const feature = await db.feature.findUnique({
      where: { id: featureId },
    });

    expect(feature?.brief).toContain('data:image/png;base64,PNG123');
    expect(feature?.brief).toContain('data:image/jpeg;base64,JPEG456');
    expect(feature?.brief).toContain('data:image/webp;base64,WEBP789');
    expect(feature?.brief).toContain('data:image/gif;base64,GIF012');
  });
});
