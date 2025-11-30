import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { computeHmacSha256Hex, timingSafeEqual } from "@/lib/encryption";
import type { Swarm } from "@prisma/client";
import type { EncryptedData } from "@/types/encryption";

/**
 * Service for Graph webhook signature verification and entity lookup.
 * Follows the proven pattern from StakgraphWebhookService.
 */
export class GraphWebhookService {
  private encryptionService: EncryptionService;

  constructor() {
    this.encryptionService = EncryptionService.getInstance();
  }

  /**
   * Lookup swarm by ID and verify HMAC signature.
   * 
   * @param swarmId - The swarm ID from the webhook payload
   * @param signature - The HMAC signature from x-signature header
   * @param rawBody - The raw request body string (before JSON parsing)
   * @returns Swarm entity if verification succeeds, null otherwise
   */
  async lookupAndVerifySwarm(
    swarmId: string,
    signature: string,
    rawBody: string
  ): Promise<Swarm | null> {
    try {
      // Step 1: Lookup entity from database
      const swarm = await db.swarm.findUnique({
        where: { id: swarmId },
      });

      if (!swarm) {
        console.error(`[GraphWebhook] Swarm not found: ${swarmId}`);
        return null;
      }

      // Step 2: Check if webhook secret is configured
      if (!swarm.graphWebhookSecret) {
        console.error(
          `[GraphWebhook] No webhook secret configured for swarm: ${swarmId}`
        );
        return null;
      }

      // Step 3: Decrypt webhook secret
      let webhookSecret: string;
      try {
        webhookSecret = this.encryptionService.decryptField(
          "graphWebhookSecret",
          swarm.graphWebhookSecret
        );
      } catch (error) {
        console.error(
          `[GraphWebhook] Failed to decrypt webhook secret for swarm ${swarmId}:`,
          error
        );
        return null;
      }

      // Step 4: Compute expected HMAC signature
      const expectedDigest = computeHmacSha256Hex(webhookSecret, rawBody);
      const expectedSignature = `sha256=${expectedDigest}`;

      // Step 5: Timing-safe comparison to prevent timing attacks
      if (!timingSafeEqual(expectedSignature, signature)) {
        console.error(
          `[GraphWebhook] Signature verification failed for swarm: ${swarmId}`
        );
        return null;
      }

      // Verification successful
      return swarm;
    } catch (error) {
      console.error(
        `[GraphWebhook] Error during verification for swarm ${swarmId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Generate a new webhook secret for a swarm.
   * Uses crypto.randomBytes for cryptographically secure random generation.
   * 
   * @returns Encrypted webhook secret ready for database storage (caller should JSON.stringify before storing)
   */
  generateWebhookSecret(): EncryptedData {
    const crypto = require("crypto");
    const plainSecret = crypto.randomBytes(32).toString("hex");
    return this.encryptionService.encryptField("graphWebhookSecret", plainSecret);
  }
}
