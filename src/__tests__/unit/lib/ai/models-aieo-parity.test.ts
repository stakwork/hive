import { describe, test, expect, afterEach } from "vitest";
import { PROVIDERS, hasApiKeyForProvider } from "aieo";
import { PROVIDER_API_KEY_ENV_VARS, PROVIDER_DISPLAY_LABELS } from "@/lib/ai/models";

/**
 * `src/lib/ai/models.ts` can't import aieo (it's pulled into client
 * bundles), so it carries its own provider -> env-var table. This test
 * pins that table to aieo's key lookup so a provider added to one side
 * (e.g. xai) can't silently be missing or mis-keyed on the other.
 */
describe("models.ts provider table matches aieo", () => {
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test.each(PROVIDERS)("aieo provider %s has a hive env var and display label", (provider) => {
    const enumKey = provider.toUpperCase();
    expect(PROVIDER_API_KEY_ENV_VARS[enumKey]).toBeTruthy();
    expect(PROVIDER_DISPLAY_LABELS[enumKey]).toBeTruthy();
  });

  test.each(PROVIDERS)("setting hive's env var for %s satisfies aieo's key lookup", (provider) => {
    const envVar = PROVIDER_API_KEY_ENV_VARS[provider.toUpperCase()]!;
    saved[envVar] = process.env[envVar];

    delete process.env[envVar];
    expect(hasApiKeyForProvider(provider)).toBe(false);

    process.env[envVar] = "parity-test-key";
    expect(hasApiKeyForProvider(provider)).toBe(true);
  });
});
