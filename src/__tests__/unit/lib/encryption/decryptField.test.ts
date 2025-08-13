import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { EncryptionService } from '@/lib/encryption';
import * as cryptoModule from '@/lib/encryption/crypto';
import type { EncryptedData } from '@/types/encryption';

// Mock the crypto module
vi.mock('@/lib/encryption/crypto', () => ({
  isEncrypted: vi.fn(),
  decrypt: vi.fn(),
}));

// Mock environment variables
vi.mock('process', () => ({
  env: {
    TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    TOKEN_ENCRYPTION_KEY_ID: 'test-key'
  }
}));

describe('EncryptionService.decryptField', () => {
  let encryptionService: EncryptionService;
  let mockIsEncrypted: Mock;
  let mockDecrypt: Mock;

  const mockEncryptedData: EncryptedData = {
    data: 'encrypted-data',
    iv: 'initialization-vector',
    tag: 'auth-tag',
    keyId: 'test-key',
    version: '1',
    encryptedAt: '2023-01-01T00:00:00Z'
  };

  const testKeyBuffer = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Get fresh instance and reset internal state
    encryptionService = EncryptionService.getInstance();
    
    // Set up test key in registry
    encryptionService.setKey('test-key', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    encryptionService.setActiveKeyId('test-key');
    
    mockIsEncrypted = cryptoModule.isEncrypted as Mock;
    mockDecrypt = cryptoModule.decrypt as Mock;
  });

  describe('when input is a string', () => {
    it('should decrypt valid JSON string containing encrypted data', () => {
      const jsonString = JSON.stringify(mockEncryptedData);
      mockIsEncrypted.mockReturnValue(true);
      mockDecrypt.mockReturnValue('decrypted-value');

      const result = encryptionService.decryptField('access_token', jsonString);

      expect(JSON.parse).toHaveBeenCalledWith(jsonString);
      expect(mockIsEncrypted).toHaveBeenCalledWith(mockEncryptedData);
      expect(mockDecrypt).toHaveBeenCalledWith(mockEncryptedData, testKeyBuffer);
      expect(result).toBe('decrypted-value');
    });

    it('should return original string when JSON parsing fails', () => {
      const invalidJson = 'not-valid-json';
      
      const result = encryptionService.decryptField('access_token', invalidJson);
      
      expect(result).toBe('not-valid-json');
    });

    it('should return original string when parsed JSON is not encrypted data', () => {
      const jsonString = JSON.stringify({ some: 'data' });
      mockIsEncrypted.mockReturnValue(false);

      const result = encryptionService.decryptField('access_token', jsonString);

      expect(mockIsEncrypted).toHaveBeenCalled();
      expect(result).toBe(jsonString);
    });

    it('should use activeKeyId when keyId is not present in encrypted data', () => {
      const dataWithoutKeyId = { ...mockEncryptedData };
      delete dataWithoutKeyId.keyId;
      const jsonString = JSON.stringify(dataWithoutKeyId);
      
      mockIsEncrypted.mockReturnValue(true);
      mockDecrypt.mockReturnValue('decrypted-value');

      const result = encryptionService.decryptField('access_token', jsonString);

      expect(mockDecrypt).toHaveBeenCalledWith(dataWithoutKeyId, testKeyBuffer);
      expect(result).toBe('decrypted-value');
    });

    it('should use "default" keyId when both keyId and activeKeyId are missing', () => {
      const dataWithoutKeyId = { ...mockEncryptedData };
      delete dataWithoutKeyId.keyId;
      const jsonString = JSON.stringify(dataWithoutKeyId);
      
      encryptionService.setActiveKeyId('');
      encryptionService.setKey('default', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
      
      mockIsEncrypted.mockReturnValue(true);
      mockDecrypt.mockReturnValue('decrypted-value');

      const result = encryptionService.decryptField('access_token', jsonString);

      expect(mockDecrypt).toHaveBeenCalledWith(dataWithoutKeyId, testKeyBuffer);
      expect(result).toBe('decrypted-value');
    });

    it('should throw error when decryption key is not found', () => {
      const dataWithDifferentKey = { ...mockEncryptedData, keyId: 'non-existent-key' };
      const jsonString = JSON.stringify(dataWithDifferentKey);
      
      mockIsEncrypted.mockReturnValue(true);

      expect(() => {
        encryptionService.decryptField('access_token', jsonString);
      }).toThrow("Decryption key for keyId 'non-existent-key' not found");
    });
  });

  describe('when input is an EncryptedData object', () => {
    it('should decrypt valid encrypted data object', () => {
      mockIsEncrypted.mockReturnValue(true);
      mockDecrypt.mockReturnValue('decrypted-value');

      const result = encryptionService.decryptField('access_token', mockEncryptedData);

      expect(mockIsEncrypted).toHaveBeenCalledWith(mockEncryptedData);
      expect(mockDecrypt).toHaveBeenCalledWith(mockEncryptedData, testKeyBuffer);
      expect(result).toBe('decrypted-value');
    });

    it('should use activeKeyId when keyId is not present in object', () => {
      const dataWithoutKeyId = { ...mockEncryptedData };
      delete dataWithoutKeyId.keyId;
      
      mockIsEncrypted.mockReturnValue(true);
      mockDecrypt.mockReturnValue('decrypted-value');

      const result = encryptionService.decryptField('access_token', dataWithoutKeyId);

      expect(mockDecrypt).toHaveBeenCalledWith(dataWithoutKeyId, testKeyBuffer);
      expect(result).toBe('decrypted-value');
    });

    it('should use "default" keyId when both keyId and activeKeyId are missing', () => {
      const dataWithoutKeyId = { ...mockEncryptedData };
      delete dataWithoutKeyId.keyId;
      
      encryptionService.setActiveKeyId('');
      encryptionService.setKey('default', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
      
      mockIsEncrypted.mockReturnValue(true);
      mockDecrypt.mockReturnValue('decrypted-value');

      const result = encryptionService.decryptField('access_token', dataWithoutKeyId);

      expect(mockDecrypt).toHaveBeenCalledWith(dataWithoutKeyId, testKeyBuffer);
      expect(result).toBe('decrypted-value');
    });

    it('should throw error when decryption key is not found for object', () => {
      const dataWithDifferentKey = { ...mockEncryptedData, keyId: 'non-existent-key' };
      
      mockIsEncrypted.mockReturnValue(true);

      expect(() => {
        encryptionService.decryptField('access_token', dataWithDifferentKey);
      }).toThrow("Decryption key for keyId 'non-existent-key' not found");
    });

    it('should throw error when object is not encrypted data', () => {
      const invalidObject = { some: 'data' };
      
      mockIsEncrypted.mockReturnValue(false);

      expect(() => {
        encryptionService.decryptField('access_token', invalidObject as EncryptedData);
      }).toThrow('Invalid encrypted data format');
    });
  });

  describe('field name parameter', () => {
    it('should work with different encryptable field types', () => {
      const fieldTypes: Array<'access_token' | 'environmentVariables' | 'poolApiKey' | 'swarmApiKey' | 'stakworkApiKey'> = [
        'access_token',
        'environmentVariables', 
        'poolApiKey',
        'swarmApiKey',
        'stakworkApiKey'
      ];

      mockIsEncrypted.mockReturnValue(true);
      mockDecrypt.mockReturnValue('decrypted-value');

      fieldTypes.forEach(fieldName => {
        const result = encryptionService.decryptField(fieldName, mockEncryptedData);
        expect(result).toBe('decrypted-value');
      });

      expect(mockDecrypt).toHaveBeenCalledTimes(fieldTypes.length);
    });
  });

  describe('edge cases', () => {
    it('should handle malformed JSON in catch block and return original string', () => {
      const malformedJson = '{"incomplete": json';
      
      const result = encryptionService.decryptField('access_token', malformedJson);
      
      expect(result).toBe('{"incomplete": json');
    });

    it('should handle null activeKeyId gracefully', () => {
      const dataWithoutKeyId = { ...mockEncryptedData };
      delete dataWithoutKeyId.keyId;
      
      // Simulate null activeKeyId
      encryptionService.setActiveKeyId('');
      const originalGetActiveKeyId = encryptionService.getActiveKeyId;
      vi.spyOn(encryptionService, 'getActiveKeyId').mockReturnValue(null);
      encryptionService.setKey('default', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
      
      mockIsEncrypted.mockReturnValue(true);
      mockDecrypt.mockReturnValue('decrypted-value');

      const result = encryptionService.decryptField('access_token', dataWithoutKeyId);

      expect(result).toBe('decrypted-value');
      
      // Restore original method
      vi.spyOn(encryptionService, 'getActiveKeyId').mockRestore();
    });

    it('should handle crypto decrypt throwing error', () => {
      mockIsEncrypted.mockReturnValue(true);
      mockDecrypt.mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      expect(() => {
        encryptionService.decryptField('access_token', mockEncryptedData);
      }).toThrow('Decryption failed');
    });
  });

  describe('error handling', () => {
    it('should preserve original error message when decryption fails', () => {
      const customError = new Error('Custom decryption error');
      mockIsEncrypted.mockReturnValue(true);
      mockDecrypt.mockImplementation(() => {
        throw customError;
      });

      expect(() => {
        encryptionService.decryptField('access_token', mockEncryptedData);
      }).toThrow('Custom decryption error');
    });

    it('should handle missing key error with proper message format', () => {
      const dataWithCustomKey = { ...mockEncryptedData, keyId: 'custom-key-123' };
      mockIsEncrypted.mockReturnValue(true);

      expect(() => {
        encryptionService.decryptField('access_token', dataWithCustomKey);
      }).toThrow("Decryption key for keyId 'custom-key-123' not found");
    });
  });

  describe('integration with getFieldEncryption', () => {
    it('should call getFieldEncryption to ensure initialization', () => {
      const spy = vi.spyOn(encryptionService as any, 'getFieldEncryption');
      mockIsEncrypted.mockReturnValue(true);
      mockDecrypt.mockReturnValue('decrypted-value');

      encryptionService.decryptField('access_token', mockEncryptedData);

      expect(spy).toHaveBeenCalled();
    });
  });
});