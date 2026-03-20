import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST as voiceSignaturePost, DELETE as voiceSignatureDelete } from '@/app/api/user/voice-signature/route';
import { POST as voiceSignatureConfirm } from '@/app/api/user/voice-signature/confirm/route';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';
import {
  generateUniqueId,
  createPostRequest,
  createDeleteRequest,
} from '@/__tests__/support/helpers';

const mockS3Service = {
  validateFileType: vi.fn(),
  validateFileSize: vi.fn(),
  validateAudioBuffer: vi.fn(),
  generateVoiceSignaturePath: vi.fn(),
  generatePresignedUploadUrl: vi.fn(),
  getObject: vi.fn(),
  deleteObject: vi.fn(),
};

vi.mock('@/services/s3', () => ({
  getS3Service: vi.fn(() => mockS3Service),
}));

vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth/nextauth', () => ({
  authOptions: {},
}));

describe('Voice Signature API Integration Tests', () => {
  const createdUserIds: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Cleanup
    if (createdUserIds.length > 0) {
      await db.users.deleteMany({
        where: { id: { in: createdUserIds } },
      });
      createdUserIds.length = 0;
    }
  });

  async function createTestUser() {
    const user = await db.users.create({
      data: {
        id: generateUniqueId('user'),
        email: `test-${generateUniqueId()}@example.com`,
        name: 'Test User',
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  function createWavBuffer(): Buffer {
    // Valid WAV file with RIFF header
    return Buffer.from([
      0x52, 0x49, 0x46, 0x46, // "RIFF"
      0x24, 0x00, 0x00, 0x00, // file size (placeholder)
      0x57, 0x41, 0x56, 0x45, // "WAVE"
      0x66, 0x6d, 0x74, 0x20, // "fmt "
      // ... rest of WAV data
    ]);
  }

  describe('POST /api/user/voice-signature', () => {
    describe('Authentication', () => {
      test('should return 401 when not authenticated', async () => {
        vi.mocked(getServerSession).mockResolvedValue(null);

        const request = createPostRequest('http://localhost:3000/api/user/voice-signature', {
          contentType: 'audio/wav',
          size: 1024,
        });

        const response = await voiceSignaturePost(request);

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.error).toContain('Unauthorized');
      });
    });

    describe('Validation', () => {
      test('should reject non-WAV content type', async () => {
        const testUser = await createTestUser();
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: testUser.id, email: testUser.email },
          expires: new Date(Date.now() + 86400000).toISOString(),
        });

        const request = createPostRequest('http://localhost:3000/api/user/voice-signature', {
          contentType: 'audio/mp3',
          size: 1024,
        });

        const response = await voiceSignaturePost(request);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBeDefined();
      });

      test('should reject file size over 50 MB', async () => {
        const testUser = await createTestUser();
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: testUser.id, email: testUser.email },
          expires: new Date(Date.now() + 86400000).toISOString(),
        });

        const request = createPostRequest('http://localhost:3000/api/user/voice-signature', {
          contentType: 'audio/wav',
          size: 51 * 1024 * 1024, // 51 MB
        });

        const response = await voiceSignaturePost(request);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBeDefined();
      });

      test('should accept valid WAV file under 50 MB', async () => {
        const testUser = await createTestUser();
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: testUser.id, email: testUser.email },
          expires: new Date(Date.now() + 86400000).toISOString(),
        });

        mockS3Service.generateVoiceSignaturePath.mockReturnValue(`voice-signatures/${testUser.id}/signature.wav`);
        mockS3Service.generatePresignedUploadUrl.mockResolvedValue('https://s3.example.com/presigned-url');

        const request = createPostRequest('http://localhost:3000/api/user/voice-signature', {
          contentType: 'audio/wav',
          size: 5 * 1024 * 1024, // 5 MB
        });

        const response = await voiceSignaturePost(request);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.presignedUrl).toBe('https://s3.example.com/presigned-url');
        expect(body.s3Path).toBe(`voice-signatures/${testUser.id}/signature.wav`);
      });
    });

    describe('S3 Integration', () => {
      test('should generate correct S3 path for user', async () => {
        const testUser = await createTestUser();
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: testUser.id, email: testUser.email },
          expires: new Date(Date.now() + 86400000).toISOString(),
        });

        mockS3Service.generateVoiceSignaturePath.mockReturnValue(`voice-signatures/${testUser.id}/signature.wav`);
        mockS3Service.generatePresignedUploadUrl.mockResolvedValue('https://s3.example.com/presigned-url');

        const request = createPostRequest('http://localhost:3000/api/user/voice-signature', {
          contentType: 'audio/wav',
          size: 1024,
        });

        await voiceSignaturePost(request);

        expect(mockS3Service.generateVoiceSignaturePath).toHaveBeenCalledWith(testUser.id);
        expect(mockS3Service.generatePresignedUploadUrl).toHaveBeenCalledWith(
          `voice-signatures/${testUser.id}/signature.wav`,
          'audio/wav',
          900
        );
      });
    });
  });

  describe('POST /api/user/voice-signature/confirm', () => {
    describe('Authentication', () => {
      test('should return 401 when not authenticated', async () => {
        vi.mocked(getServerSession).mockResolvedValue(null);

        const request = createPostRequest('http://localhost:3000/api/user/voice-signature/confirm', {
          s3Path: 'voice-signatures/user-123/signature.wav',
        });

        const response = await voiceSignatureConfirm(request);

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.error).toContain('Unauthorized');
      });
    });

    describe('Validation', () => {
      test('should reject invalid WAV buffer', async () => {
        const testUser = await createTestUser();
        const s3Path = `voice-signatures/${testUser.id}/signature.wav`;
        
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: testUser.id, email: testUser.email },
          expires: new Date(Date.now() + 86400000).toISOString(),
        });

        mockS3Service.generateVoiceSignaturePath.mockReturnValue(s3Path);
        const invalidBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
        mockS3Service.getObject.mockResolvedValue(invalidBuffer);
        mockS3Service.validateAudioBuffer.mockReturnValue(false);
        mockS3Service.deleteObject.mockResolvedValue(undefined);

        const request = createPostRequest('http://localhost:3000/api/user/voice-signature/confirm', {
          s3Path,
        });

        const response = await voiceSignatureConfirm(request);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('Invalid audio file');
        expect(mockS3Service.deleteObject).toHaveBeenCalledWith(s3Path);
      });

      test('should accept valid WAV buffer and update database', async () => {
        const testUser = await createTestUser();
        const s3Path = `voice-signatures/${testUser.id}/signature.wav`;
        
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: testUser.id, email: testUser.email },
          expires: new Date(Date.now() + 86400000).toISOString(),
        });

        mockS3Service.generateVoiceSignaturePath.mockReturnValue(s3Path);
        const wavBuffer = createWavBuffer();
        mockS3Service.getObject.mockResolvedValue(wavBuffer);
        mockS3Service.validateAudioBuffer.mockReturnValue(true);

        const request = createPostRequest('http://localhost:3000/api/user/voice-signature/confirm', {
          s3Path,
        });

        const response = await voiceSignatureConfirm(request);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);

        // Verify database was updated
        const user = await db.users.findUnique({
          where: { id: testUser.id },
        });
        expect(user?.voiceSignatureKey).toBe(s3Path);
      });
    });
  });

  describe('DELETE /api/user/voice-signature', () => {
    describe('Authentication', () => {
      test('should return 401 when not authenticated', async () => {
        vi.mocked(getServerSession).mockResolvedValue(null);

        const request = createDeleteRequest('http://localhost:3000/api/user/voice-signature');

        const response = await voiceSignatureDelete(request);

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.error).toContain('Unauthorized');
      });
    });

    describe('Deletion', () => {
      test('should return 404 when user has no voice signature', async () => {
        const testUser = await createTestUser();
        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: testUser.id, email: testUser.email },
          expires: new Date(Date.now() + 86400000).toISOString(),
        });

        const request = createDeleteRequest('http://localhost:3000/api/user/voice-signature');

        const response = await voiceSignatureDelete(request);

        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.error).toContain('No voice signature');
      });

      test('should delete S3 object and clear database field', async () => {
        const testUser = await createTestUser();
        const s3Path = `voice-signatures/${testUser.id}/signature.wav`;
        
        // Set voice signature key
        await db.users.update({
          where: { id: testUser.id },
          data: { voiceSignatureKey: s3Path },
        });

        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: testUser.id, email: testUser.email },
          expires: new Date(Date.now() + 86400000).toISOString(),
        });

        mockS3Service.deleteObject.mockResolvedValue(undefined);

        const request = createDeleteRequest('http://localhost:3000/api/user/voice-signature');

        const response = await voiceSignatureDelete(request);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);

        expect(mockS3Service.deleteObject).toHaveBeenCalledWith(s3Path);

        // Verify database was updated
        const user = await db.users.findUnique({
          where: { id: testUser.id },
        });
        expect(user?.voiceSignatureKey).toBeNull();
      });

      test('should handle S3 deletion failures gracefully', async () => {
        const testUser = await createTestUser();
        const s3Path = `voice-signatures/${testUser.id}/signature.wav`;
        
        await db.users.update({
          where: { id: testUser.id },
          data: { voiceSignatureKey: s3Path },
        });

        vi.mocked(getServerSession).mockResolvedValue({
          user: { id: testUser.id, email: testUser.email },
          expires: new Date(Date.now() + 86400000).toISOString(),
        });

        mockS3Service.deleteObject.mockRejectedValue(new Error('S3 Error'));

        const request = createDeleteRequest('http://localhost:3000/api/user/voice-signature');

        const response = await voiceSignatureDelete(request);

        // Should still succeed and clear DB even if S3 fails
        expect(response.status).toBe(200);

        const user = await db.users.findUnique({
          where: { id: testUser.id },
        });
        expect(user?.voiceSignatureKey).toBeNull();
      });
    });
  });
});
