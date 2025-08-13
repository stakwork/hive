import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EncryptionService } from '@/lib/encryption';
import * as cryptoModule from '@/lib/encryption/crypto';
import { EncryptedData, EncryptableField } from '@/types/encryption';

// Mock the crypto module
vi.mock('@/lib/encryption/crypto', () => ({
  isEncrypted: vi.fn(),
  decrypt: vi.fn(),
}));

// Mock environment variables
vi.mock('process', () => ({
  env: {
    TOKEN_ENCRYPTION_KEY: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    TOKEN_ENCRYPTION_KEY_ID: 'test-key-id',
  },
}));

describe('EncryptionService.decryptField', () => {
  let encryptionService: EncryptionService;
  const mockKeyBuffer = Buffer.from('test-key-buffer');
  const mockDecryptedValue = 'decrypted-value';
  
  const validEncryptedData: EncryptedData = {
    data: 'encrypted-data',
    iv: 'iv-data',
    tag: 'tag-data',
    keyId: 'test-key-id',
    version: '1',
    encryptedAt: '2023-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
    
    // Reset singleton instance
    // @ts-expect-error - accessing private static property for testing
    EncryptionService.instance = undefined;
    
    // Get fresh instance
    encryptionService = EncryptionService.getInstance();
    
    // Setup default key in registry
    encryptionService.setKey('test-key-id', 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
    encryptionService.setKey('default', 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
    encryptionService.setActiveKeyId('test-key-id');
    
    // Mock crypto module functions
    vi.mocked(cryptoModule.decrypt).mockReturnValue(mockDecryptedValue);
    vi.mocked(cryptoModule.isEncrypted).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('string input handling', () => {
    it('should decrypt valid encrypted JSON string', () => {
      const encryptedJsonString = JSON.stringify(validEncryptedData);
      
      const result = encryptionService.decryptField('access_token', encryptedJsonString);
      
      expect(cryptoModule.isEncrypted).toHaveBeenCalledWith(validEncryptedData);
      expect(cryptoModule.decrypt).toHaveBeenCalledWith(validEncryptedData, expect.any(Buffer));
      expect(result).toBe(mockDecryptedValue);
    });

    it('should return original string when JSON parsing fails', () => {
      const invalidJsonString = 'not-valid-json';
      
      const result = encryptionService.decryptField('access_token', invalidJsonString);
      
      expect(result).toBe(invalidJsonString);
      expect(cryptoModule.decrypt).not.toHaveBeenCalled();
    });

    it('should return original string when parsed JSON is not encrypted data', () => {
      const nonEncryptedJsonString = JSON.stringify({ someField: 'value' });
      vi.mocked(cryptoModule.isEncrypted).mockReturnValue(false);
      
      const result = encryptionService.decryptField('access_token', nonEncryptedJsonString);
      
      expect(result).toBe(nonEncryptedJsonString);
      expect(cryptoModule.decrypt).not.toHaveBeenCalled();
    });

    it('should return original string when decryption throws an error', () => {
      const encryptedJsonString = JSON.stringify(validEncryptedData);
      vi.mocked(cryptoModule.decrypt).mockImplementation(() => {
        throw new Error('Decryption failed');
      });
      
      const result = encryptionService.decryptField('access_token', encryptedJsonString);
      
      expect(result).toBe(encryptedJsonString);
    });

    it('should return original string when key is not found', () => {
      const dataWithMissingKey = { ...validEncryptedData, keyId: 'missing-key' };
      const encryptedJsonString = JSON.stringify(dataWithMissingKey);
      
      const result = encryptionService.decryptField('access_token', encryptedJsonString);
      
      expect(result).toBe(encryptedJsonString);
      expect(cryptoModule.decrypt).not.toHaveBeenCalled();
    });
  });

  describe('object input handling', () => {
    it('should decrypt valid encrypted data object', () => {
      const result = encryptionService.decryptField('access_token', validEncryptedData);
      
      expect(cryptoModule.isEncrypted).toHaveBeenCalledWith(validEncryptedData);
      expect(cryptoModule.decrypt).toHaveBeenCalledWith(validEncryptedData, expect.any(Buffer));
      expect(result).toBe(mockDecryptedValue);
    });

    it('should throw error when object is not encrypted data format', () => {
      const nonEncryptedObject = { someField: 'value' };
      vi.mocked(cryptoModule.isEncrypted).mockReturnValue(false);
      
      expect(() => {
        encryptionService.decryptField('access_token', nonEncryptedObject as any);
      }).toThrow('Invalid encrypted data format');
      
      expect(cryptoModule.decrypt).not.toHaveBeenCalled();
    });

    it('should throw error when key is not found for object input', () => {
      const dataWithMissingKey = { ...validEncryptedData, keyId: 'missing-key' };
      
      expect(() => {
        encryptionService.decryptField('access_token', dataWithMissingKey);
      }).toThrow("Decryption key for keyId 'missing-key' not found");
      
      expect(cryptoModule.decrypt).not.toHaveBeenCalled();
    });
  });

  describe('key resolution', () => {
    it('should use keyId from encrypted data when present', () => {
      const dataWithSpecificKey = { ...validEncryptedData, keyId: 'specific-key' };
      encryptionService.setKey('specific-key', 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
      
      const result = encryptionService.decryptField('access_token', dataWithSpecificKey);
      
      expect(cryptoModule.decrypt).toHaveBeenCalledWith(dataWithSpecificKey, expect.any(Buffer));
      expect(result).toBe(mockDecryptedValue);
    });

    it('should fallback to activeKeyId when keyId is not present', () => {
      const dataWithoutKeyId = { ...validEncryptedData };
      delete dataWithoutKeyId.keyId;
      encryptionService.setActiveKeyId('active-key');
      encryptionService.setKey('active-key', 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
      
      const result = encryptionService.decryptField('access_token', dataWithoutKeyId);
      
      expect(cryptoModule.decrypt).toHaveBeenCalledWith(dataWithoutKeyId, expect.any(Buffer));
      expect(result).toBe(mockDecryptedValue);
    });

    it('should fallback to "default" when keyId and activeKeyId are not available', () => {
      const dataWithoutKeyId = { ...validEncryptedData };
      delete dataWithoutKeyId.keyId;
      encryptionService.setActiveKeyId('');
      
      const result = encryptionService.decryptField('access_token', dataWithoutKeyId);
      
      expect(cryptoModule.decrypt).toHaveBeenCalledWith(dataWithoutKeyId, expect.any(Buffer));
      expect(result).toBe(mockDecryptedValue);
    });

    it('should handle empty string keyId by falling back to activeKeyId', () => {
      const dataWithEmptyKeyId = { ...validEncryptedData, keyId: '' };
      encryptionService.setActiveKeyId('fallback-key');
      encryptionService.setKey('fallback-key', 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
      
      const result = encryptionService.decryptField('access_token', dataWithEmptyKeyId);
      
      expect(cryptoModule.decrypt).toHaveBeenCalledWith(dataWithEmptyKeyId, expect.any(Buffer));
      expect(result).toBe(mockDecryptedValue);
    });
  });

  describe('field name variations', () => {
    const fieldNames: EncryptableField[] = [
      'access_token',
      'environmentVariables',
      'poolApiKey',
      'swarmApiKey',
      'stakworkApiKey'
    ];

    fieldNames.forEach(fieldName => {
      it(`should decrypt ${fieldName} field successfully`, () => {
        const result = encryptionService.decryptField(fieldName, validEncryptedData);
        
        expect(result).toBe(mockDecryptedValue);
        expect(cryptoModule.decrypt).toHaveBeenCalledWith(validEncryptedData, expect.any(Buffer));
      });
    });
  });

  describe('edge cases', () => {
    it('should handle null keyId in encrypted data', () => {
      const dataWithNullKeyId = { ...validEncryptedData, keyId: null as any };
      
      const result = encryptionService.decryptField('access_token', dataWithNullKeyId);
      
      expect(result).toBe(mockDecryptedValue);
      expect(cryptoModule.decrypt).toHaveBeenCalled();
    });

    it('should handle undefined keyId in encrypted data', () => {
      const dataWithUndefinedKeyId = { ...validEncryptedData, keyId: undefined };
      
      const result = encryptionService.decryptField('access_token', dataWithUndefinedKeyId);
      
      expect(result).toBe(mockDecryptedValue);
      expect(cryptoModule.decrypt).toHaveBeenCalled();
    });

    it('should handle empty JSON string', () => {
      const result = encryptionService.decryptField('access_token', '');
      
      expect(result).toBe('');
      expect(cryptoModule.decrypt).not.toHaveBeenCalled();
    });

    it('should handle whitespace-only JSON string', () => {
      const whitespaceString = '   ';
      
      const result = encryptionService.decryptField('access_token', whitespaceString);
      
      expect(result).toBe(whitespaceString);
      expect(cryptoModule.decrypt).not.toHaveBeenCalled();
    });

    it('should handle very large encrypted data', () => {
      const largeData = { 
        ...validEncryptedData, 
        data: 'a'.repeat(10000) // Very large data string
      };
      
      const result = encryptionService.decryptField('access_token', largeData);
      
      expect(result).toBe(mockDecryptedValue);
      expect(cryptoModule.decrypt).toHaveBeenCalledWith(largeData, expect.any(Buffer));
    });
  });

  describe('getFieldEncryption initialization', () => {
    it('should call getFieldEncryption to ensure initialization', () => {
      const spy = vi.spyOn(encryptionService as any, 'getFieldEncryption');
      
      encryptionService.decryptField('access_token', validEncryptedData);
      
      expect(spy).toHaveBeenCalled();
    });

    it('should work with uninitialized service', () => {
      // Create a fresh instance without manual key setup
      // @ts-expect-error - accessing private static property for testing
      EncryptionService.instance = undefined;
      const freshService = EncryptionService.getInstance();
      
      const result = freshService.decryptField('access_token', validEncryptedData);
      
      expect(result).toBe(mockDecryptedValue);
    });
  });

  describe('error propagation from crypto module', () => {
    it('should propagate decryption errors for object input', () => {
      const cryptoError = new Error('Crypto decryption failed');
      vi.mocked(cryptoModule.decrypt).mockImplementation(() => {
        throw cryptoError;
      });
      
      expect(() => {
        encryptionService.decryptField('access_token', validEncryptedData);
      }).toThrow('Crypto decryption failed');
    });

    it('should handle crypto module throwing non-Error objects', () => {
      vi.mocked(cryptoModule.decrypt).mockImplementation(() => {
        throw 'String error';
      });
      
      expect(() => {
        encryptionService.decryptField('access_token', validEncryptedData);
      }).toThrow();
    });
  });

  describe('JSON parsing edge cases', () => {
    it('should handle malformed JSON with extra characters', () => {
      const malformedJson = '{"valid": "json"}extra-chars';
      
      const result = encryptionService.decryptField('access_token', malformedJson);
      
      expect(result).toBe(malformedJson);
    });

    it('should handle JSON with circular references in catch block', () => {
      // This tests the catch block when JSON.parse throws
      const circularObj: any = {};
      circularObj.self = circularObj;
      const jsonString = 'invalid-json-that-will-throw';
      
      const result = encryptionService.decryptField('access_token', jsonString);
      
      expect(result).toBe(jsonString);
    });

    it('should handle valid JSON that represents primitive values', () => {
      const primitiveJsonString = '"just a string"';
      vi.mocked(cryptoModule.isEncrypted).mockReturnValue(false);
      
      const result = encryptionService.decryptField('access_token', primitiveJsonString);
      
      expect(result).toBe(primitiveJsonString);
    });

    it('should handle JSON arrays', () => {
      const arrayJsonString = '[1, 2, 3]';
      vi.mocked(cryptoModule.isEncrypted).mockReturnValue(false);
      
      const result = encryptionService.decryptField('access_token', arrayJsonString);
      
      expect(result).toBe(arrayJsonString);
    });
  });
});