import { describe, it, expect } from 'vitest';
import { getS3Service } from '@/services/s3';

describe('S3Service - Voice Signature', () => {
  describe('generateVoiceSignaturePath', () => {
    it('should generate correct path format for voice signature', () => {
      const s3Service = getS3Service();
      const userId = 'user-123';
      const path = s3Service.generateVoiceSignaturePath(userId);

      expect(path).toBe('voice-signatures/user-123/signature.wav');
    });

    it('should generate deterministic path for same user', () => {
      const s3Service = getS3Service();
      const userId = 'user-abc';
      
      const path1 = s3Service.generateVoiceSignaturePath(userId);
      const path2 = s3Service.generateVoiceSignaturePath(userId);

      expect(path1).toBe(path2);
      expect(path1).toBe('voice-signatures/user-abc/signature.wav');
    });

    it('should generate unique paths for different users', () => {
      const s3Service = getS3Service();
      
      const path1 = s3Service.generateVoiceSignaturePath('user-1');
      const path2 = s3Service.generateVoiceSignaturePath('user-2');

      expect(path1).not.toBe(path2);
      expect(path1).toBe('voice-signatures/user-1/signature.wav');
      expect(path2).toBe('voice-signatures/user-2/signature.wav');
    });
  });

  describe('validateAudioBuffer', () => {
    it('should validate WAV file with correct RIFF header', () => {
      const s3Service = getS3Service();
      
      // WAV file starts with "RIFF" (0x52, 0x49, 0x46, 0x46)
      const wavBuffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // "RIFF"
        0x00, 0x00, 0x00, 0x00, // file size (placeholder)
        0x57, 0x41, 0x56, 0x45, // "WAVE"
        // ... rest of WAV data
      ]);

      const isValid = s3Service.validateAudioBuffer(wavBuffer, 'audio/wav');
      expect(isValid).toBe(true);
    });

    it('should reject buffer with incorrect magic numbers', () => {
      const s3Service = getS3Service();
      
      // Invalid header
      const invalidBuffer = Buffer.from([
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
      ]);

      const isValid = s3Service.validateAudioBuffer(invalidBuffer, 'audio/wav');
      expect(isValid).toBe(false);
    });

    it('should reject buffer that is too short', () => {
      const s3Service = getS3Service();
      
      // Only 2 bytes
      const shortBuffer = Buffer.from([0x52, 0x49]);

      const isValid = s3Service.validateAudioBuffer(shortBuffer, 'audio/wav');
      expect(isValid).toBe(false);
    });

    it('should reject unsupported audio type', () => {
      const s3Service = getS3Service();
      
      const buffer = Buffer.from([0x52, 0x49, 0x46, 0x46]);

      const isValid = s3Service.validateAudioBuffer(buffer, 'audio/mp3');
      expect(isValid).toBe(false);
    });
  });
});
