/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSphinxToken } from "@/lib/auth/sphinx-token";
import { decode } from "next-auth/jwt";

describe("createSphinxToken", () => {
  const originalSecret = process.env.NEXTAUTH_SECRET;

  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-key-for-sphinx-token-generation";
  });

  afterEach(() => {
    process.env.NEXTAUTH_SECRET = originalSecret;
  });

  it("should generate a non-empty JWT token string", async () => {
    const token = await createSphinxToken(
      "user123",
      "test@example.com",
      "Test User"
    );

    expect(token).toBeDefined();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("should generate a token that can be decoded by next-auth/jwt", async () => {
    const userId = "user456";
    const email = "decode@example.com";
    const name = "Decode Test";

    const token = await createSphinxToken(userId, email, name);

    // Decode the token using next-auth/jwt
    const decoded = await decode({
      token,
      secret: process.env.NEXTAUTH_SECRET!,
    });

    expect(decoded).toBeDefined();
    expect(decoded).not.toBeNull();
  });

  it("should include correct payload structure with id, email, and name", async () => {
    const userId = "user789";
    const email = "payload@example.com";
    const name = "Payload Test";

    const token = await createSphinxToken(userId, email, name);

    // Decode to verify payload structure
    const decoded = await decode({
      token,
      secret: process.env.NEXTAUTH_SECRET!,
    });

    expect(decoded).toMatchObject({
      id: userId,
      email,
      name,
    });
  });

  it("should handle null email gracefully", async () => {
    const token = await createSphinxToken("user123", null, "Test User");

    const decoded = await decode({
      token,
      secret: process.env.NEXTAUTH_SECRET!,
    });

    expect(decoded).toBeDefined();
    expect(decoded?.id).toBe("user123");
    expect(decoded?.email).toBeNull();
    expect(decoded?.name).toBe("Test User");
  });

  it("should handle null name gracefully", async () => {
    const token = await createSphinxToken(
      "user123",
      "test@example.com",
      null
    );

    const decoded = await decode({
      token,
      secret: process.env.NEXTAUTH_SECRET!,
    });

    expect(decoded).toBeDefined();
    expect(decoded?.id).toBe("user123");
    expect(decoded?.email).toBe("test@example.com");
    expect(decoded?.name).toBeNull();
  });

  it("should handle undefined email and name", async () => {
    const token = await createSphinxToken("user123", undefined, undefined);

    const decoded = await decode({
      token,
      secret: process.env.NEXTAUTH_SECRET!,
    });

    expect(decoded).toBeDefined();
    expect(decoded?.id).toBe("user123");
  });

  it("should throw error when NEXTAUTH_SECRET is missing", async () => {
    delete process.env.NEXTAUTH_SECRET;

    await expect(
      createSphinxToken("user123", "test@example.com", "Test User")
    ).rejects.toThrow("NEXTAUTH_SECRET environment variable is required");
  });

  it("should generate different tokens for different users", async () => {
    const token1 = await createSphinxToken("user1", "user1@example.com", "User One");
    const token2 = await createSphinxToken("user2", "user2@example.com", "User Two");

    expect(token1).not.toBe(token2);

    const decoded1 = await decode({
      token: token1,
      secret: process.env.NEXTAUTH_SECRET!,
    });

    const decoded2 = await decode({
      token: token2,
      secret: process.env.NEXTAUTH_SECRET!,
    });

    expect(decoded1?.id).toBe("user1");
    expect(decoded2?.id).toBe("user2");
  });

  it("should generate tokens with appropriate expiration", async () => {
    const token = await createSphinxToken(
      "user123",
      "test@example.com",
      "Test User"
    );

    const decoded = await decode({
      token,
      secret: process.env.NEXTAUTH_SECRET!,
    });

    expect(decoded).toBeDefined();
    expect(decoded?.exp).toBeDefined();
    expect(decoded?.iat).toBeDefined();

    // Token should expire in approximately 30 days (allow some variance)
    const expectedExpiry = 30 * 24 * 60 * 60; // 30 days in seconds
    const actualDuration = (decoded?.exp as number) - (decoded?.iat as number);
    
    // Allow 1 second variance
    expect(actualDuration).toBeGreaterThanOrEqual(expectedExpiry - 1);
    expect(actualDuration).toBeLessThanOrEqual(expectedExpiry + 1);
  });
});
