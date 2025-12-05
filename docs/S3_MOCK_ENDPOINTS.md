# S3 Mock Endpoints Documentation

This document describes the mock S3 implementation for local development and testing.

## Overview

The S3 mock system provides in-memory file storage for local development, eliminating the need for AWS credentials during development and testing. It follows the same patterns as other mock services (GitHub, Stakwork, Pool Manager) in the codebase.

## Enabling Mock Mode

Set the `USE_MOCKS` environment variable to enable S3 mocking:

```bash
# .env.local
USE_MOCKS=true
```

When enabled:
- AWS credentials (`AWS_ROLE_ARN`, `S3_BUCKET_NAME`) are not required
- S3 operations route to in-memory storage
- Presigned URLs point to local mock endpoints
- Files persist in memory during the server session

## Architecture

### Components

1. **S3MockState** (`src/lib/mock/s3-state.ts`)
   - Singleton state manager for in-memory file storage
   - Stores files as Buffer objects with metadata
   - Auto-creates mock files on download if they don't exist
   - Provides reset() method for test isolation

2. **S3MockWrapper** (`src/lib/mock/s3-wrapper.ts`)
   - Implements S3Service interface
   - Routes operations to S3MockState
   - Maintains same validation logic as real S3Service

3. **Mock API Endpoints**
   - `PUT /api/mock/s3/upload?key={s3Key}&contentType={type}` - File upload
   - `GET /api/mock/s3/download/{s3Key}` - File download

### Flow

```
Client Request
    ↓
getS3Service() checks USE_MOCKS
    ↓ (if true)
S3MockWrapper.generatePresignedUploadUrl()
    ↓
Returns: http://localhost:3000/api/mock/s3/upload?key=...
    ↓
Client uploads to mock endpoint
    ↓
File stored in S3MockState (in-memory)
    ↓
Download URLs point to: /api/mock/s3/download/{key}
```

## Mock Presigned URLs

### Upload URLs
```
http://localhost:3000/api/mock/s3/upload?key=uploads%2F{workspace}%2F{swarm}%2F{task}%2F{file}&contentType=image%2Fpng
```

### Download URLs
```
http://localhost:3000/api/mock/s3/download/uploads%2F{workspace}%2F{swarm}%2F{task}%2F{file}
```

## Features

### Auto-Create Mock Files

When a download URL is requested for a non-existent file, the mock automatically creates:
- **Images** (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`): 1x1 transparent PNG
- **Videos** (`.mp4`, `.webm`, `.mov`): Minimal valid WebM file
- **Other files**: Empty file with `application/octet-stream` content type

This prevents 404 errors and allows any configuration to work without pre-seeding data.

### File Validation

Mock maintains the same validation rules as production:
- **Allowed types**: Images (JPEG, PNG, GIF, WebP) and videos (MP4, WebM, MOV)
- **Size limit**: 10MB maximum
- **Magic number verification**: Validates file signatures to prevent type spoofing

### Path Generation

Mock uses identical path structure as production:

**Task attachments:**
```
uploads/{workspaceId}/{swarmId}/{taskId}/{timestamp}_{randomId}_{filename}
```

**Workspace logos:**
```
workspaces/{workspaceId}/logo/{timestamp}_{filename}
```

**Video recordings:**
```
uploads/{workspaceId}/{swarmId}/{taskId}/recording_{timestamp}_{randomId}.webm
```

## Testing

### Unit Tests

Test mock state operations:

```typescript
import { s3MockState } from '@/lib/mock/s3-state';

describe('S3MockState', () => {
  beforeEach(() => {
    s3MockState.reset();
  });

  it('should store and retrieve files', () => {
    const buffer = Buffer.from('test content');
    s3MockState.storeFile('test-key', buffer, 'text/plain');
    
    const file = s3MockState.getFile('test-key');
    expect(file.buffer.toString()).toBe('test content');
    expect(file.contentType).toBe('text/plain');
  });
});
```

### Integration Tests

Test file upload flow:

```typescript
describe('POST /api/upload/presigned-url', () => {
  it('should generate mock presigned URL when USE_MOCKS=true', async () => {
    const response = await request(app)
      .post('/api/upload/presigned-url')
      .send({ taskId, filename: 'test.png', contentType: 'image/png', size: 1024 });

    expect(response.body.presignedUrl).toContain('/api/mock/s3/upload');
  });
});
```

### E2E Tests

Test full user journey:

```typescript
test('should upload and display image in chat', async ({ page }) => {
  // Upload image via mock presigned URL
  const fileInput = await page.locator('input[type="file"]');
  await fileInput.setInputFiles('test-image.png');
  
  // Verify image displays with mock download URL
  const image = await page.locator('img[src*="/api/mock/s3/download"]');
  await expect(image).toBeVisible();
});
```

## Limitations

⚠️ **In-memory only** - Files don't persist across server restarts  
⚠️ **Not production-ready** - Only for dev/test environments  
⚠️ **Memory consumption** - Large files consume server memory  
⚠️ **No S3 features** - No versioning, lifecycle policies, or advanced S3 features

## Troubleshooting

### Issue: Files disappear on server restart

**Cause**: Mock storage is in-memory only  
**Solution**: This is expected behavior. Re-upload files or use database-seeded content.

### Issue: Mock endpoints return 404

**Cause**: `USE_MOCKS=true` not set or server not restarted  
**Solution**: 
1. Verify `USE_MOCKS=true` in `.env.local`
2. Restart development server
3. Check server logs for "Mock endpoints enabled"

### Issue: Upload fails with "Missing required parameter: key"

**Cause**: Client not using presigned URL correctly  
**Solution**: Ensure you're using the full presigned URL returned by the API, not constructing your own.

### Issue: Image displays as broken

**Cause**: File uploaded with wrong content type or corrupt buffer  
**Solution**: 
1. Check upload logs for errors
2. Verify buffer is valid image data
3. Use `s3MockState.getFile(key)` to inspect stored file

## State Management

### Reset State (Testing)

```typescript
import { s3MockState } from '@/lib/mock/s3-state';

afterEach(() => {
  if (process.env.NODE_ENV === 'test') {
    s3MockState.reset();
  }
});
```

### Inspect State (Debugging)

```typescript
import { s3MockState } from '@/lib/mock/s3-state';

// Get storage statistics
const stats = s3MockState.getStats();
console.log(`Files: ${stats.fileCount}, Total size: ${stats.totalSize} bytes`);

// Check if file exists
const exists = s3MockState.fileExists('uploads/workspace-1/swarm-1/task-1/test.png');
console.log(`File exists: ${exists}`);
```

## Production Deployment

The mock system is completely isolated from production:

1. **Environment gating**: Mock endpoints check `USE_MOCKS` at runtime
2. **Factory routing**: `getS3Service()` only returns mock when `USE_MOCKS=true`
3. **Validation skipped**: AWS credential validation skipped only in mock mode
4. **404 protection**: Mock endpoints return 404 when `USE_MOCKS=false`

**Never set `USE_MOCKS=true` in production environments.**

## Comparison with Real S3

| Feature | Real S3 | Mock S3 |
|---------|---------|---------|
| Authentication | IAM/OIDC credentials | None required |
| Storage | Durable, distributed | In-memory, temporary |
| URL expiration | Based on IAM credentials | No expiration |
| Performance | Network latency | In-process, instant |
| Cost | Storage + bandwidth | Free |
| Scalability | Unlimited | Limited by server memory |
| Features | Full S3 API | Basic upload/download only |

## Related Documentation

- [Mock Services Overview](./MOCK_SERVICES.md) - Overview of all mock implementations
- [Testing Strategy](./TESTING.md) - Integration and E2E testing patterns
- [Environment Configuration](./ENVIRONMENT.md) - Environment variable setup
- [S3 Integration](./S3_INTEGRATION.md) - Production S3 architecture

## Support

For issues or questions:
1. Check server logs for errors
2. Verify environment configuration
3. Review existing integration tests for examples
4. Consult mock state manager source code