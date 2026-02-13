import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { createTestUser, createTestWorkspace, createTestFeature } from '@/__tests__/support/factories';
import { filterImagesFromDisplay } from '@/lib/utils/markdown-filters';

describe('Brief Markdown Filtering Integration', () => {
  beforeEach(async () => {
    // Clean up test data
    await db.feature.deleteMany({});
    await db.workspace.deleteMany({});
    await db.user.deleteMany({});
  });

  it('should preserve markdown image in database while displaying placeholder', async () => {
    // Create test user and workspace
    const user = await createTestUser({ email: 'test@example.com' });
    const workspace = await createTestWorkspace({ 
      ownerId: user.id,
      name: 'Test Workspace',
      slug: 'test-workspace',
    });

    // Create feature with markdown image in brief
    const briefWithImage = `Bug Report: Login button not working

Description: The login button throws an error when clicked.

![Error Screenshot](https://s3.amazonaws.com/my-bucket/screenshots/login-error.png?AWSAccessKeyId=AKIAEXAMPLE&Expires=1234567890)

Steps to reproduce:
1. Navigate to login page
2. Click the login button
3. Observe error

Expected: User should be logged in
Actual: Error is thrown`;

    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: user.id,
      updatedById: user.id,
      title: 'Fix Login Button Bug',
      brief: briefWithImage,
      status: 'BACKLOG',
      priority: 'HIGH',
    });

    // Verify full markdown is in database
    expect(feature.brief).toContain('![Error Screenshot](https://s3.amazonaws.com');
    expect(feature.brief).toContain('AWSAccessKeyId=AKIAEXAMPLE');

    // Verify display filtering works
    const displayText = filterImagesFromDisplay(feature.brief!);
    expect(displayText).toContain('[Image: login-error.png]');
    expect(displayText).not.toContain('https://s3.amazonaws.com');
    expect(displayText).not.toContain('AWSAccessKeyId');

    // Verify other text is preserved
    expect(displayText).toContain('Bug Report: Login button not working');
    expect(displayText).toContain('Steps to reproduce');
  });

  it('should handle multiple images in brief', async () => {
    const user = await createTestUser({ email: 'test2@example.com' });
    const workspace = await createTestWorkspace({ 
      ownerId: user.id,
      name: 'Test Workspace 2',
      slug: 'test-workspace-2',
    });

    const briefWithMultipleImages = `Multiple Screenshot Bug Report

![Screenshot 1](https://s3.amazonaws.com/bucket/image1.png)

Some text in between

![Screenshot 2](https://s3.amazonaws.com/bucket/image2.jpg?key=value)`;

    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: user.id,
      updatedById: user.id,
      title: 'Multiple Images Bug',
      brief: briefWithMultipleImages,
      status: 'BACKLOG',
      priority: 'MEDIUM',
    });

    const displayText = filterImagesFromDisplay(feature.brief!);
    
    expect(displayText).toContain('[Image: image1.png]');
    expect(displayText).toContain('[Image: image2.jpg]');
    expect(displayText).toContain('Some text in between');
    expect(displayText).not.toContain('https://s3.amazonaws.com');
  });

  it('should handle S3 URLs with query parameters correctly', async () => {
    const user = await createTestUser({ email: 'test3@example.com' });
    const workspace = await createTestWorkspace({ 
      ownerId: user.id,
      name: 'Test Workspace 3',
      slug: 'test-workspace-3',
    });

    const briefWithS3Url = `Bug with screenshot

![Bug Screenshot](https://s3.amazonaws.com/my-bucket/path/to/screenshot.png?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Expires=1234567890&Signature=abc123)`;

    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: user.id,
      updatedById: user.id,
      title: 'S3 URL Bug',
      brief: briefWithS3Url,
      status: 'BACKLOG',
      priority: 'LOW',
    });

    const displayText = filterImagesFromDisplay(feature.brief!);
    
    // Should extract clean filename without query params
    expect(displayText).toContain('[Image: screenshot.png]');
    expect(displayText).not.toContain('AWSAccessKeyId');
    expect(displayText).not.toContain('Expires');
    expect(displayText).not.toContain('Signature');
  });

  it('should preserve markdown during edits', async () => {
    const user = await createTestUser({ email: 'test4@example.com' });
    const workspace = await createTestWorkspace({ 
      ownerId: user.id,
      name: 'Test Workspace 4',
      slug: 'test-workspace-4',
    });

    const originalBrief = `Original text

![Screenshot](https://s3.amazonaws.com/bucket/image.png)

More text`;

    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: user.id,
      updatedById: user.id,
      title: 'Edit Test',
      brief: originalBrief,
      status: 'BACKLOG',
      priority: 'MEDIUM',
    });

    // Simulate editing by updating the brief (in real app, user would edit via UI)
    // The markdown image should be preserved
    const updatedBrief = originalBrief.replace('Original text', 'Updated text');
    
    await db.feature.update({
      where: { id: feature.id },
      data: { brief: updatedBrief },
    });

    const updated = await db.feature.findUnique({
      where: { id: feature.id },
    });

    // Verify markdown image is still in database
    expect(updated!.brief).toContain('![Screenshot](https://s3.amazonaws.com');
    expect(updated!.brief).toContain('Updated text');
  });

  it('should handle empty or null brief correctly', async () => {
    // Test null brief
    const nullDisplayText = filterImagesFromDisplay(null as any);
    expect(nullDisplayText).toBe('');
    
    // Test empty string brief
    const emptyDisplayText = filterImagesFromDisplay('');
    expect(emptyDisplayText).toBe('');
    
    // Test undefined brief (using || operator like component does)
    const undefinedBrief = undefined as any;
    const undefinedDisplayText = filterImagesFromDisplay(undefinedBrief || '');
    expect(undefinedDisplayText).toBe('');
  });

  it('should handle brief with no images', async () => {
    const user = await createTestUser({ email: 'test6@example.com' });
    const workspace = await createTestWorkspace({ 
      ownerId: user.id,
      name: 'Test Workspace 6',
      slug: 'test-workspace-6',
    });

    const textOnlyBrief = `This is a bug report with no images.

Just plain text describing the issue.`;

    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: user.id,
      updatedById: user.id,
      title: 'Text Only Bug',
      brief: textOnlyBrief,
      status: 'BACKLOG',
      priority: 'HIGH',
    });

    const displayText = filterImagesFromDisplay(feature.brief!);
    
    // Should return original text unchanged
    expect(displayText).toBe(textOnlyBrief);
  });

  it('should handle images without alt text', async () => {
    const user = await createTestUser({ email: 'test7@example.com' });
    const workspace = await createTestWorkspace({ 
      ownerId: user.id,
      name: 'Test Workspace 7',
      slug: 'test-workspace-7',
    });

    const briefWithNoAlt = `Bug report

![](https://s3.amazonaws.com/bucket/screenshot.png)

No alt text on image above`;

    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: user.id,
      updatedById: user.id,
      title: 'No Alt Text',
      brief: briefWithNoAlt,
      status: 'BACKLOG',
      priority: 'MEDIUM',
    });

    const displayText = filterImagesFromDisplay(feature.brief!);
    
    expect(displayText).toContain('[Image: screenshot.png]');
    expect(displayText).toContain('No alt text on image above');
  });

  it('should handle consecutive images with proper spacing', async () => {
    const user = await createTestUser({ email: 'test8@example.com' });
    const workspace = await createTestWorkspace({ 
      ownerId: user.id,
      name: 'Test Workspace 8',
      slug: 'test-workspace-8',
    });

    const briefWithConsecutiveImages = `Multiple images:

![Image 1](https://s3.amazonaws.com/bucket/img1.png)
![Image 2](https://s3.amazonaws.com/bucket/img2.png)
![Image 3](https://s3.amazonaws.com/bucket/img3.png)

End of images`;

    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: user.id,
      updatedById: user.id,
      title: 'Consecutive Images',
      brief: briefWithConsecutiveImages,
      status: 'BACKLOG',
      priority: 'LOW',
    });

    const displayText = filterImagesFromDisplay(feature.brief!);
    
    expect(displayText).toContain('[Image: img1.png]');
    expect(displayText).toContain('[Image: img2.png]');
    expect(displayText).toContain('[Image: img3.png]');
    expect(displayText).toContain('Multiple images:');
    expect(displayText).toContain('End of images');
  });
});
