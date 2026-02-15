// @vitest-environment node

import { describe, it, expect, beforeAll } from "vitest";
import { decode } from "next-auth/jwt";
import { createSphinxToken } from "@/lib/auth/sphinx-token";

describe("Debug Sphinx Token", () => {
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-key-for-testing";
  });

  it("should create and decode token correctly", async () => {
    const userId = "test-user-id";
    const email = "test@example.com";
    const name = "Test User";

    // Create token
    const token = await createSphinxToken(userId, email, name);
    console.log("Created token:", token);

    // Decode token
    const decoded = await decode({ 
      token, 
      secret: process.env.NEXTAUTH_SECRET! 
    });
    
    console.log("Decoded token:", JSON.stringify(decoded, null, 2));
    console.log("Decoded.id:", decoded?.id);
    console.log("Decoded.email:", decoded?.email);
    console.log("Decoded.name:", decoded?.name);

    expect(decoded?.id).toBe(userId);
    expect(decoded?.email).toBe(email);
    expect(decoded?.name).toBe(name);
  });
});
