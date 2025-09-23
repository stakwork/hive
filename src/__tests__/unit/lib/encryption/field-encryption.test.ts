import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FieldEncryptionService } from '@/lib/encryption/field-encryption';
import * as crypto from '@/lib/encryption/crypto';
import { EncryptedData, EncryptableField, EncryptionError } from '@/types/encryption';

// Mock the crypto module
vi.mock('@/lib/encryption/crypto', () => ({
  decrypt: vi.fn(),
  isEncrypted: vi.fn(),
  hexToBuffer: vi.fn(),
}));

describe('FieldEncryptionService.decryptField', () => {
  let service: FieldEncryptionService;
  const mockKey = 'a'.repeat(64); // 64 hex characters = 32 bytes
  const testFieldName: EncryptableField = 'access_token';
  
  const mockEncryptedData: EncryptedData = {
    data: 'encrypted_data_base64',
    iv: 'iv_base64',
    tag: 'tag_base64',
    keyId: 'test-key',
    version: '1',
    encryptedAt: '2024-01-01T00:00:00.000Z',
  };

  const mockDecryptedValue = 'decrypted_secret_value';

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock hexToBuffer to return a Buffer
    (crypto.hexToBuffer as any).mockReturnValue(Buffer.from('mock_key_bytes'));
    
    service = new FieldEncryptionService(mockKey);
  });

  describe('successful decryption scenarios', () => {
    it('should decrypt valid EncryptedData object', () => {
      // Arrange
      (crypto.isEncrypted as any).mockReturnValue(true);
      (crypto.decrypt as any).mockReturnValue(mockDecryptedValue);

      // Act
      const result = service.decryptField(testFieldName, mockEncryptedData);

      // Assert
      expect(result).toBe(mockDecryptedValue);
      expect(crypto.isEncrypted).toHaveBeenCalledWith(mockEncryptedData);
      expect(crypto.decrypt).toHaveBeenCalledWith(mockEncryptedData, expect.any(Buffer));
    });

    it('should decrypt valid encrypted JSON string', () => {
      // Arrange
      const encryptedJsonString = JSON.stringify(mockEncryptedData);
      (crypto.isEncrypted as any).mockReturnValue(true);
      (crypto.decrypt as any).mockReturnValue(mockDecryptedValue);

      // Act
      const result = service.decryptField(testFieldName, encryptedJsonString);

      // Assert
      expect(result).toBe(mockDecryptedValue);
      expect(crypto.isEncrypted).toHaveBeenCalledWith(mockEncryptedData);
      expect(crypto.decrypt).toHaveBeenCalledWith(mockEncryptedData, expect.any(Buffer));
    });

    it('should return plain text string unchanged (backwards compatibility)', () => {
      // Arrange
      const plainTextValue = 'plain_text_token';

      // Act
      const result = service.decryptField(testFieldName, plainTextValue);

      // Assert
      expect(result).toBe(plainTextValue);
      expect(crypto.isEncrypted).not.toHaveBeenCalled();
      expect(crypto.decrypt).not.toHaveBeenCalled();
    });

    it('should return invalid JSON string unchanged', () => {
      // Arrange
      const invalidJsonString = 'invalid{json}string';

      // Act
      const result = service.decryptField(testFieldName, invalidJsonString);

      // Assert
      expect(result).toBe(invalidJsonString);
      expect(crypto.decrypt).not.toHaveBeenCalled();
    });

    it('should return parsed JSON string that is not encrypted', () => {
      // Arrange
      const nonEncryptedData = { someField: 'someValue' };
      const nonEncryptedJsonString = JSON.stringify(nonEncryptedData);
      (crypto.isEncrypted as any).mockReturnValue(false);

      // Act
      const result = service.decryptField(testFieldName, nonEncryptedJsonString);

      // Assert
      expect(result).toBe(nonEncryptedJsonString);
      expect(crypto.isEncrypted).toHaveBeenCalledWith(nonEncryptedData);
      expect(crypto.decrypt).not.toHaveBeenCalled();
    });
  });

  describe('error scenarios', () => {
    it('should throw EncryptionError when EncryptedData object is invalid', () => {
      // Arrange
      const invalidEncryptedData = { invalid: 'data' };
      (crypto.isEncrypted as any).mockReturnValue(false);

      // Act & Assert
      expect(() => {
        service.decryptField(testFieldName, invalidEncryptedData as any);
      }).toThrow();
      
      try {
        service.decryptField(testFieldName, invalidEncryptedData as any);
      } catch (error) {
        const encryptionError = error as EncryptionError;
        expect(encryptionError.message).toBe(`Failed to decrypt field: ${testFieldName}`);
        expect(encryptionError.code).toBe('DECRYPTION_FAILED');
        expect(encryptionError.field).toBe(testFieldName);
        expect(encryptionError.error).toBe('Invalid encrypted data format');
      }
    });

    it('should throw EncryptionError when crypto.decrypt fails', () => {
      // Arrange
      const cryptoError = new Error('Crypto decryption failed');
      (crypto.isEncrypted as any).mockReturnValue(true);
      (crypto.decrypt as any).mockImplementation(() => {
        throw cryptoError;
      });

      // Act & Assert
      expect(() => {
        service.decryptField(testFieldName, mockEncryptedData);
      }).toThrow();

      try {
        service.decryptField(testFieldName, mockEncryptedData);
      } catch (error) {
        const encryptionError = error as EncryptionError;
        expect(encryptionError.message).toBe(`Failed to decrypt field: ${testFieldName}`);
        expect(encryptionError.code).toBe('DECRYPTION_FAILED');
        expect(encryptionError.field).toBe(testFieldName);
        expect(encryptionError.error).toBe('Crypto decryption failed');
      }
    });

    it('should throw EncryptionError when crypto.decrypt fails with encrypted JSON string', () => {
      // Arrange
      const encryptedJsonString = JSON.stringify(mockEncryptedData);
      const cryptoError = new Error('Invalid authentication tag');
      (crypto.isEncrypted as any).mockReturnValue(true);
      (crypto.decrypt as any).mockImplementation(() => {
        throw cryptoError;
      });

      // Act & Assert - The method should throw an error because decrypt() throws
      try {
        service.decryptField(testFieldName, encryptedJsonString);
        throw new Error('Expected method to throw an error');
      } catch (error: any) {
        // The error thrown should be the outer try/catch error, not the inner one
        if (error.message === 'Expected method to throw an error') {
          throw error; // If this is our test error, the actual method didn't throw
        }
        expect(error.message).toBe(`Failed to decrypt field: ${testFieldName}`);
        expect(error.code).toBe('DECRYPTION_FAILED');
        expect(error.field).toBe(testFieldName);
        expect(error.error).toBe('Invalid authentication tag');
      }
    });

    it('should handle non-Error thrown objects in crypto operations', () => {
      // Arrange
      const nonErrorObject = 'string error';
      (crypto.isEncrypted as any).mockReturnValue(true);
      (crypto.decrypt as any).mockImplementation(() => {
        throw nonErrorObject;
      });

      // Act & Assert
      try {
        service.decryptField(testFieldName, mockEncryptedData);
      } catch (error) {
        const encryptionError = error as EncryptionError;
        expect(encryptionError.message).toBe(`Failed to decrypt field: ${testFieldName}`);
        expect(encryptionError.code).toBe('DECRYPTION_FAILED');
        expect(encryptionError.field).toBe(testFieldName);
        expect(encryptionError.error).toBe('string error');
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty string input', () => {
      // Act
      const result = service.decryptField(testFieldName, '');

      // Assert
      expect(result).toBe('');
      expect(crypto.isEncrypted).not.toHaveBeenCalled();
      expect(crypto.decrypt).not.toHaveBeenCalled();
    });

    it('should handle different EncryptableField types', () => {
      // Arrange
      const fieldTypes: EncryptableField[] = [
        'refresh_token',
        'id_token',
        'environmentVariables',
        'poolApiKey',
        'swarmApiKey',
        'swarmPassword',
        'stakworkApiKey',
        'githubWebhookSecret',
        'app_access_token',
        'app_refresh_token',
        'source_control_token',
        'source_control_refresh_token',
      ];
      (crypto.isEncrypted as any).mockReturnValue(true);
      (crypto.decrypt as any).mockReturnValue(mockDecryptedValue);

      // Act & Assert
      fieldTypes.forEach(fieldType => {
        const result = service.decryptField(fieldType, mockEncryptedData);
        expect(result).toBe(mockDecryptedValue);
      });
    });

    it('should preserve field name in error messages for different field types', () => {
      // Arrange
      const testField: EncryptableField = 'githubWebhookSecret';
      const invalidData = { invalid: 'format' };
      (crypto.isEncrypted as any).mockReturnValue(false);

      // Act & Assert
      try {
        service.decryptField(testField, invalidData as any);
      } catch (error) {
        const encryptionError = error as EncryptionError;
        expect(encryptionError.message).toBe(`Failed to decrypt field: ${testField}`);
        expect(encryptionError.field).toBe(testField);
      }
    });

    it('should handle whitespace-only JSON strings', () => {
      // Act
      const result = service.decryptField(testFieldName, '   ');

      // Assert
      expect(result).toBe('   ');
      expect(crypto.isEncrypted).not.toHaveBeenCalled();
      expect(crypto.decrypt).not.toHaveBeenCalled();
    });

    it('should handle valid JSON that parses to null', () => {
      // Arrange
      (crypto.isEncrypted as any).mockReturnValue(false);
      
      // Act
      const result = service.decryptField(testFieldName, 'null');

      // Assert
      expect(result).toBe('null');
      expect(crypto.isEncrypted).toHaveBeenCalledWith(null);
      expect(crypto.decrypt).not.toHaveBeenCalled();
    });

    it('should handle malformed EncryptedData missing required fields', () => {
      // Arrange
      const malformedData = {
        data: 'some_data',
        // Missing iv, tag, version, encryptedAt
      };
      (crypto.isEncrypted as any).mockReturnValue(false);

      // Act & Assert
      expect(() => {
        service.decryptField(testFieldName, malformedData as any);
      }).toThrow();

      try {
        service.decryptField(testFieldName, malformedData as any);
      } catch (error) {
        const encryptionError = error as EncryptionError;
        expect(encryptionError.code).toBe('DECRYPTION_FAILED');
        expect(encryptionError.field).toBe(testFieldName);
      }
    });
  });

  describe('integration with crypto module', () => {
    it('should call crypto.isEncrypted with correct parameters', () => {
      // Arrange
      (crypto.isEncrypted as any).mockReturnValue(false);

      // Act & Assert
      try {
        service.decryptField(testFieldName, mockEncryptedData);
        throw new Error('Should have thrown');
      } catch (error) {
        const encryptionError = error as EncryptionError;
        expect(encryptionError.message).toBe(`Failed to decrypt field: ${testFieldName}`);
        expect(encryptionError.code).toBe('DECRYPTION_FAILED');
      }
      
      expect(crypto.isEncrypted).toHaveBeenCalledWith(mockEncryptedData);
      expect(crypto.isEncrypted).toHaveBeenCalledTimes(1);
    });

    it('should call crypto.decrypt with correct parameters', () => {
      // Arrange
      (crypto.isEncrypted as any).mockReturnValue(true);
      (crypto.decrypt as any).mockReturnValue(mockDecryptedValue);

      // Act
      service.decryptField(testFieldName, mockEncryptedData);

      // Assert
      expect(crypto.decrypt).toHaveBeenCalledWith(mockEncryptedData, expect.any(Buffer));
      expect(crypto.decrypt).toHaveBeenCalledTimes(1);
    });

    it('should use the key provided in constructor', () => {
      // Arrange
      (crypto.isEncrypted as any).mockReturnValue(true);
      (crypto.decrypt as any).mockReturnValue(mockDecryptedValue);

      // Act
      service.decryptField(testFieldName, mockEncryptedData);

      // Assert
      expect(crypto.hexToBuffer).toHaveBeenCalledWith(mockKey);
      expect(crypto.decrypt).toHaveBeenCalledWith(mockEncryptedData, expect.any(Buffer));
    });
  });
});