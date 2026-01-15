/**
 * Load environment variables BEFORE any other imports
 * This must be the first file imported in vitest setup
 */
import { config } from "dotenv";
import { resolve } from "path";

// Load .env.test for integration tests
if (process.env.TEST_SUITE === "integration") {
  const envPath = resolve(process.cwd(), ".env.test");
  const result = config({ path: envPath });
  
  console.log("[load-env] Loading .env.test from:", envPath);
  console.log("[load-env] TEST_DATABASE_URL:", process.env.TEST_DATABASE_URL);
  console.log("[load-env] DATABASE_URL (before):", process.env.DATABASE_URL);

  // Ensure DATABASE_URL is set to TEST_DATABASE_URL
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    console.log("[load-env] DATABASE_URL (after):", process.env.DATABASE_URL);
  } else {
    console.error("[load-env] ERROR: TEST_DATABASE_URL not found in .env.test");
  }
}
