import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import crypto from "crypto";
import { validateWorkspaceAccess } from "@/services/workspace";

interface CreateApiKeyParams {
  workspaceId: string;
  userId: string;
  name: string;
  permissions: string[];
  expiresAt?: Date;
}

interface ValidateApiKeyResult {
  isValid: boolean;
  workspaceId?: string;
  permissions?: string[];
  apiKeyId?: string;
}

export class ApiKeyService {
  private encryptionService: EncryptionService;

  constructor() {
    this.encryptionService = EncryptionService.getInstance();
  }

  /**
   * Generates a secure random API key
   */
  generateKey(): string {
    return `hive_${crypto.randomBytes(32).toString("hex")}`;
  }

  /**
   * Creates a SHA256 hash of the API key for storage
   */
  hashKey(key: string): string {
    return crypto.createHash("sha256").update(key).digest("hex");
  }

  /**
   * Creates a new API key for a workspace
   * TODO: Implement this once the ApiKey model is added to Prisma schema
   */
  async createApiKey({
    workspaceId,
    userId,
    name,
    permissions,
    expiresAt,
  }: CreateApiKeyParams): Promise<{ id: string; key: string }> {
    throw new Error("API Key functionality not yet implemented - requires ApiKey model in database");
    
    /* TODO: Uncomment when ApiKey model is added to Prisma schema
    // Generate the actual API key
    const key = this.generateKey();
    const keyHash = this.hashKey(key);

    // Encrypt the full key for secure storage
    const encryptedKey = this.encryptionService.encryptField("apiKey", key);

    // Create database record
    const apiKey = await db.apiKey.create({
      data: {
        workspaceId,
        name,
        keyHash,
        encryptedKey: JSON.stringify(encryptedKey),
        permissions,
        expiresAt,
        createdBy: userId,
        isActive: true,
      },
    });

    return {
      id: apiKey.id,
      key, // Return plaintext key only once during creation
    };
    */
  }

  /**
   * Validates an API key and returns associated workspace and permissions
   * TODO: Implement this once the ApiKey model is added to Prisma schema
   */
  async validateApiKey(key: string): Promise<ValidateApiKeyResult> {
    throw new Error("API Key functionality not yet implemented - requires ApiKey model in database");
    
    /* TODO: Uncomment when ApiKey model is added to Prisma schema
    const keyHash = this.hashKey(key);

    const apiKey = await db.apiKey.findFirst({
      where: {
        keyHash,
        isActive: true,
      },
      select: {
        id: true,
        workspaceId: true,
        permissions: true,
        expiresAt: true,
      },
    });

    if (!apiKey) {
      return { isValid: false };
    }

    // Check expiration
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return { isValid: false };
    }

    // Update last used timestamp
    await db.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      isValid: true,
      workspaceId: apiKey.workspaceId,
      permissions: apiKey.permissions,
      apiKeyId: apiKey.id,
    };
    */
  }

  /**
   * Revokes an API key
   * TODO: Implement this once the ApiKey model is added to Prisma schema
   */
  async revokeApiKey(
    apiKeyId: string,
    workspaceSlug: string,
    userId: string,
  ): Promise<void> {
    throw new Error("API Key functionality not yet implemented - requires ApiKey model in database");
    
    /* TODO: Uncomment when ApiKey model is added to Prisma schema
    const access = await validateWorkspaceAccess(workspaceSlug, userId);
    if (!access.canAdmin) {
      throw new Error("Insufficient permissions to revoke API keys");
    }

    await db.apiKey.update({
      where: { id: apiKeyId },
      data: { isActive: false },
    });
    */
  }

  /**
   * Lists all API keys for a workspace
   * TODO: Implement this once the ApiKey model is added to Prisma schema
   */
  async listApiKeys(workspaceId: string) {
    throw new Error("API Key functionality not yet implemented - requires ApiKey model in database");
    
    /* TODO: Uncomment when ApiKey model is added to Prisma schema
    return db.apiKey.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        permissions: true,
        lastUsedAt: true,
        expiresAt: true,
        isActive: true,
        createdAt: true,
        createdBy: true,
      },
      orderBy: { createdAt: "desc" },
    });
    */
  }

  /**
   * Rotates an existing API key (creates new key, deactivates old)
   * TODO: Implement this once the ApiKey model is added to Prisma schema
   */
  async rotateApiKey(
    apiKeyId: string,
    workspaceSlug: string,
    userId: string,
  ): Promise<{ id: string; key: string }> {
    throw new Error("API Key functionality not yet implemented - requires ApiKey model in database");
    
    /* TODO: Uncomment when ApiKey model is added to Prisma schema
    const access = await validateWorkspaceAccess(workspaceSlug, userId);
    if (!access.canAdmin) {
      throw new Error("Insufficient permissions to rotate API keys");
    }

    const oldKey = await db.apiKey.findUnique({
      where: { id: apiKeyId },
      select: {
        workspaceId: true,
        name: true,
        permissions: true,
        expiresAt: true,
      },
    });

    if (!oldKey) {
      throw new Error("API key not found");
    }

    // Create new key with same properties
    const newKey = await this.createApiKey({
      workspaceId: oldKey.workspaceId,
      userId,
      name: `${oldKey.name} (rotated)`,
      permissions: oldKey.permissions,
      expiresAt: oldKey.expiresAt || undefined,
    });

    // Deactivate old key
    await db.apiKey.update({
      where: { id: apiKeyId },
      data: { isActive: false },
    });

    return newKey;
    */
  }
}

export const apiKeyService = () => new ApiKeyService();