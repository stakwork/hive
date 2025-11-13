/**
import { logger } from "@/lib/logger";
 * Retry a function with exponential backoff or fixed delay
 */
export async function retryWithDelay<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 25,
  delayMs: number = 1200,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        console.warn(`⚠️ Attempt ${attempt}/${maxAttempts} failed, retrying in ${delayMs}ms...`, error);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  logger.error(`❌ All ${maxAttempts} attempts failed`, "retry");
  throw lastError;
}
