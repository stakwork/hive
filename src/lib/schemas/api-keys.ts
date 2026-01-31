import { z } from "zod";

/**
 * Schema for creating a new API key
 */
export const createApiKeySchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or less")
    .trim(),
  expiresAt: z
    .string()
    .datetime({ message: "Invalid date format" })
    .optional()
    .nullable()
    .transform((val) => (val ? new Date(val) : null)),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

/**
 * Response type for API key list items (never includes raw key)
 */
export interface ApiKeyListItem {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdBy: {
    id: string;
    name: string | null;
  };
  isRevoked: boolean;
  revokedAt: Date | null;
}

/**
 * Response type for newly created API key (includes raw key - shown once)
 */
export interface CreateApiKeyResponse {
  id: string;
  name: string;
  keyPrefix: string;
  key: string; // Full key - only returned once!
  createdAt: Date;
  expiresAt: Date | null;
}
