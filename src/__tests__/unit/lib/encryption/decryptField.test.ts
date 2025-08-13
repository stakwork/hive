import { describe, it, expect, vi, beforeEach } from "vitest";
import { EncryptionService } from "@/lib/encryption";
import * as cryptoModule from "@/lib/encryption/crypto";
import { EncryptedData, EncryptableField } from "@/types/encryption";

// Mock the crypto module
vi.mock("@/lib/encryption/crypto", () => ({
  isEncrypted: vi.fn(),
  decrypt: vi.fn(),
}));

describe("EncryptionService.decryptField", () => {
  let encryptionService: EncryptionService;
  let mockKeyRegistry: Map<string, Buffer>;
  let mockGetFieldEncryption: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create fresh instance
    encryptionService = EncryptionService.getInstance();
    
    // Mock keyRegistry
    mockKeyRegistry = new Map<string, Buffer>();
    mockKeyRegistry.set("default", Buffer.from("defaultkey123456789012345678901234", "utf8"));
    mockKeyRegistry.set("key1", Buffer.from("testkey1234567890123456789012345", "utf8"));
    mockKeyRegistry.set("key2", Buffer.from("testkey2234567890123456789012345", "utf8"));
    
    // Mock internal methods and properties
    Object.defineProperty(encryptionService, "keyRegistry", {
      get: () => mockKeyRegistry,
      configurable: true,
    });
    
    Object.defineProperty(encryptionService, "activeKeyId", {
      get: () => "default",
      configurable: true,
    });
    
    mockGetFieldEncryption = vi.fn();
    Object.defineProperty(encryptionService, "getFieldEncryption", {
      value: mockGetFieldEncryption,
      configurable: true,
    });
  });

  const mockEncryptedData: EncryptedData = {
    data: "encrypted-content",
    iv: "test-iv",
    tag: "test-tag",
    keyId: "key1",
    version: "1",
    encryptedAt: "2024-01-01T00:00:00Z",
  };

  const fieldName: EncryptableField = "access_token";

  describe("when encryptedData is a string", () => {
    it("should decrypt valid encrypted JSON string", () => {
      const encryptedString = JSON.stringify(mockEncryptedData);
      const decryptedValue = "decrypted-value";
      
      vi.mocked(cryptoModule.isEncrypted).mockReturnValue(true);
      vi.mocked(cryptoModule.decrypt).mockReturnValue(decryptedValue);
      
      const result = encryptionService.decryptField(fieldName, encryptedString);
      
      expect(mockGetFieldEncryption).toHaveBeenCalled();
      expect(cryptoModule.isEncrypted).toHaveBeenCalledWith(mockEncryptedData);
      expect(cryptoModule.decrypt).toHaveBeenCalledWith(
        mockEncryptedData,
        mockKeyRegistry.get("key1")
      );
      expect(result).toBe(decryptedValue);
    });

    it("should return original string if parsed JSON is not encrypted data", () => {
      const nonEncryptedJson = JSON.stringify({ data: "plain-data" });
      
      vi.mocked(cryptoModule.isEncrypted).mockReturnValue(false);
      
      const result = encryptionService.decryptField(fieldName, nonEncryptedJson);
      
      expect(mockGetFieldEncryption).toHaveBeenCalled();
      expect(cryptoModule.isEncrypted).toHaveBeenCalled();
      expect(cryptoModule.decrypt).not.toHaveBeenCalled();
      expect(result).toBe(nonEncryptedJson);
    });

    it("should return original string if JSON parsing fails", () => {
      const invalidJson = "invalid-json-string";
      
      const result = encryptionService.decryptField(fieldName, invalidJson);
      
      expect(mockGetFieldEncryption).toHaveBeenCalled();
      expect(cryptoModule.isEncrypted).not.toHaveBeenCalled();
      expect(cryptoModule.decrypt).not.toHaveBeenCalled();
      expect(result).toBe(invalidJson);
    });

    it("should use activeKeyId when keyId is not provided in encrypted data", () => {
      const encryptedDataWithoutKeyId = { ...mockEncryptedData };
      delete encryptedDataWithoutKeyId.keyId;
      const encryptedString = JSON.stringify(encryptedDataWithoutKeyId);
      const decryptedValue = "decrypted-value";
      
      vi.mocked(cryptoModule.isEncrypted).mockReturnValue(true);
      vi.mocked(cryptoModule.decrypt).mockReturnValue(decryptedValue);
      
      const result = encryptionService.decryptField(fieldName, encryptedString);
      
      expect(cryptoModule.decrypt).toHaveBeenCalledWith(
        encryptedDataWithoutKeyId,
        mockKeyRegistry.get("default") // activeKeyId
      );
      expect(result).toBe(decryptedValue);
    });

    it("should use 'default' keyId when neither keyId nor activeKeyId is available", () => {
      const encryptedDataWithoutKeyId = { ...mockEncryptedData };
      delete encryptedDataWithoutKeyId.keyId;
      const encryptedString = JSON.stringify(encryptedDataWithoutKeyId);
      const decryptedValue = "decrypted-value";
      
      // Mock activeKeyId as null
      Object.defineProperty(encryptionService, "activeKeyId", {
        get: () => null,
        configurable: true,
      });
      
      vi.mocked(cryptoModule.isEncrypted).mockReturnValue(true);
      vi.mocked(cryptoModule.decrypt).mockReturnValue(decryptedValue);
      
      const result = encryptionService.decryptField(fieldName, encryptedString);
      
      expect(cryptoModule.decrypt).toHaveBeenCalledWith(
        encryptedDataWithoutKeyId,
        mockKeyRegistry.get("default")
      );
      expect(result).toBe(decryptedValue);
    });

    it("should throw error when decryption key is not found", () => {
      const encryptedDataWithUnknownKey = { ...mockEncryptedData, keyId: "unknown-key" };
      const encryptedString = JSON.stringify(encryptedDataWithUnknownKey);
      
      vi.mocked(cryptoModule.isEncrypted).mockReturnValue(true);
      
      expect(() => {
        encryptionService.decryptField(fieldName, encryptedString);
      }).toThrow("Decryption key for keyId 'unknown-key' not found");
    });
  });

  describe("when encryptedData is an object", () => {
    it("should decrypt valid encrypted data object", () => {
      const decryptedValue = "decrypted-value";
      
      vi.mocked(cryptoModule.isEncrypted).mockReturnValue(true);
      vi.mocked(cryptoModule.decrypt).mockReturnValue(decryptedValue);
      
      const result = encryptionService.decryptField(fieldName, mockEncryptedData);
      
      expect(mockGetFieldEncryption).toHaveBeenCalled();
      expect(cryptoModule.isEncrypted).toHaveBeenCalledWith(mockEncryptedData);
      expect(cryptoModule.decrypt).toHaveBeenCalledWith(
        mockEncryptedData,
        mockKeyRegistry.get("key1")
      );
      expect(result).toBe(decryptedValue);
    });

    it("should use activeKeyId when keyId is not provided in object", () => {
      const encryptedDataWithoutKeyId = { ...mockEncryptedData };
      delete encryptedDataWithoutKeyId.keyId;
      const decryptedValue = "decrypted-value";
      
      vi.mocked(cryptoModule.isEncrypted).mockReturnValue(true);
      vi.mocked(cryptoModule.decrypt).mockReturnValue(decryptedValue);
      
      const result = encryptionService.decryptField(fieldName, encryptedDataWithoutKeyId);
      
      expect(cryptoModule.decrypt).toHaveBeenCalledWith(
        encryptedDataWithoutKeyId,
        mockKeyRegistry.get("default") // activeKeyId
      );
      expect(result).toBe(decryptedValue);
    });

    it("should use 'default' keyId when neither keyId nor activeKeyId is available", () => {
      const encryptedDataWithoutKeyId = { ...mockEncryptedData };
      delete encryptedDataWithoutKeyId.keyId;
      const decryptedValue = "decrypted-value";
      
      // Mock activeKeyId as null
      Object.defineProperty(encryptionService, "activeKeyId", {
        get: () => null,
        configurable: true,
      });
      
      vi.mocked(cryptoModule.isEncrypted).mockReturnValue(true);
      vi.mocked(cryptoModule.decrypt).mockReturnValue(decryptedValue);
      
      const result = encryptionService.decryptField(fieldName, encryptedDataWithoutKeyId);
      
      expect(cryptoModule.decrypt).toHaveBeenCalledWith(
        encryptedDataWithoutKeyId,
        mockKeyRegistry.get("default")
      );
      expect(result).toBe(decryptedValue);
    });

    it("should throw error when decryption key is not found", () => {
      const encryptedDataWithUnknownKey = { ...mockEncryptedData, keyId: "unknown-key" };
      
      vi.mocked(cryptoModule.isEncrypted).mockReturnValue(true);
      
      expect(() => {
        encryptionService.decryptField(fieldName, encryptedDataWithUnknownKey);
      }).toThrow("Decryption key for keyId 'unknown-key' not found");
    });

    it("should throw error when object is not encrypted data", () => {
      const nonEncryptedObject = { data: "plain-data" };
      
      vi.mocked(cryptoModule.isEncrypted).mockReturnValue(false);
      
      expect(() => {
        encryptionService.decryptField(fieldName, nonEncryptedObject as any);
      }).toThrow("Invalid encrypted data format");
    });
  });

  describe("edge cases", () => {
    it("should handle empty keyId gracefully", () => {
      const encryptedDataWithEmptyKeyId = { ...mockEncryptedData, keyId: "" };
      const decryptedValue = "decrypted-value";
      
      vi.mocked(cryptoModule.isEncrypted).mockReturnValue(true);
      vi.mocked(cryptoModule.decrypt).mockReturnValue(decryptedValue);
      
      const result = encryptionService.decryptField(fieldName, encryptedDataWithEmptyKeyId);
      
      expect(cryptoModule.decrypt).toHaveBeenCalledWith(
        encryptedDataWithEmptyKeyId,
        mockKeyRegistry.get("default") // fallback to activeKeyId -> default
      );
      expect(result).toBe(decryptedValue);
    });

    it("should handle different encryptable field types", () => {
      const fieldTypes: EncryptableField[] = [
        "access_token",
        "environmentVariables", 
        "poolApiKey",
        "swarmApiKey",
        "stakworkApiKey"
      ];
      const decryptedValue = "decrypted-value";
      
      vi.mocked(cryptoModule.isEncrypted).mockReturnValue(true);
      vi.mocked(cryptoModule.decrypt).mockReturnValue(decryptedValue);
      
      fieldTypes.forEach(fieldType => {
        const result = encryptionService.decryptField(fieldType, mockEncryptedData);
        expect(result).toBe(decryptedValue);
      });
    });

    it("should handle null or undefined gracefully", () => {
      expect(() => {
        encryptionService.decryptField(fieldName, null as any);
      }).toThrow("Invalid encrypted data format");
      
      expect(() => {
        encryptionService.decryptField(fieldName, undefined as any);
      }).toThrow("Invalid encrypted data format");
    });

    it("should handle number input gracefully", () => {
      expect(() => {
        encryptionService.decryptField(fieldName, 123 as any);
      }).toThrow("Invalid encrypted data format");
    });
  });

  describe("getFieldEncryption integration", () => {
    it("should always call getFieldEncryption first", () => {
      const plainString = "plain-text";
      
      encryptionService.decryptField(fieldName, plainString);
      
      expect(mockGetFieldEncryption).toHaveBeenCalledTimes(1);
    });

    it("should call getFieldEncryption even if subsequent operations fail", () => {
      vi.mocked(cryptoModule.isEncrypted).mockReturnValue(true);
      const encryptedDataWithUnknownKey = { ...mockEncryptedData, keyId: "unknown-key" };
      
      expect(() => {
        encryptionService.decryptField(fieldName, encryptedDataWithUnknownKey);
      }).toThrow();
      
      expect(mockGetFieldEncryption).toHaveBeenCalledTimes(1);
    });
  });
});