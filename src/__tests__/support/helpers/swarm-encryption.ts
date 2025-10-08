import { EncryptionService } from "@/lib/encryption";
import type { EncryptedData } from "@/types";

export interface SwarmEncryptionTestData {
  workspaceId: string;
  swarmUrl: string;
  swarmApiKey: string;
  repositoryUrl: string;
  name: string;
}

/**
 * Creates swarm test data with properly encrypted API key
 * Uses the mocked EncryptionService in test environment
 */
export function createSwarmWithEncryptedApiKey(
  data: SwarmEncryptionTestData
): {
  workspaceId: string;
  swarmUrl: string;
  swarmApiKey: string;
  repositoryUrl: string;
  name: string;
} {
  // Create mock encrypted data format for tests
  const mockEncryptedData = createMockEncryptedData(data.swarmApiKey);

  return {
    workspaceId: data.workspaceId,
    swarmUrl: data.swarmUrl,
    swarmApiKey: JSON.stringify(mockEncryptedData),
    repositoryUrl: data.repositoryUrl,
    name: data.name,
  };
}

/**
 * Creates mock encrypted data for testing
 */
export function createMockEncryptedData(value: string): EncryptedData {
  return {
    data: "encrypted_" + value,
    iv: "mock_iv_" + Math.random().toString(36).substring(7),
    tag: "mock_tag_" + Math.random().toString(36).substring(7),
    keyId: "test",
    version: "1",
    encryptedAt: new Date().toISOString(),
  };
}

/**
 * Default test API key for consistent testing
 */
export const DEFAULT_TEST_API_KEY = "test-api-key-" + Math.random().toString(36).substring(7);
