/**
 * Retry a function with exponential backoff or fixed delay
 */
export async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  {
    maxAttempts = 8,
    baseDelayMs = 1000,
    maxDelayMs = 90000,
  }: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
        console.warn(`⚠️ Attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms...`, error);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  console.error(`❌ All ${maxAttempts} attempts failed`);
  throw lastError;
}

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
  console.error(`❌ All ${maxAttempts} attempts failed`);
  throw lastError;
}
