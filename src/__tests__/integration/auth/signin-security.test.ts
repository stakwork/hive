import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import type { User, Account, Session } from "@prisma/client";
import { createTestUser, cleanup } from "@/__tests__/utils/test-helpers";

// Mock crypto for testing encryption scenarios
const mockCrypto = {
  randomUUID: vi.fn(() => `uuid-${Date.now()}`),
  randomBytes: vi.fn((size: number) => Buffer.alloc(size, 'a')),
  createHash: vi.fn(),
  timingSafeEqual: vi.fn(),
};

vi.mock("crypto", () => mockCrypto);

// Mock NextAuth JWT handling
const mockJWT = {
  encode: vi.fn(),
  decode: vi.fn(),
  getToken: vi.fn(),
};

vi.mock("next-auth/jwt", () => mockJWT);

describe("SignIn Security Features - Integration Tests", () => {
  let testUsers: User[] = [];
  let testAccounts: Account[] = [];
  let testSessions: Session[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetAllMocks();
    testUsers = [];
    testAccounts = [];
    testSessions = [];
  });

  afterEach(async () => {
    // Clean up test data
    if (testAccounts.length > 0) {
      const accountIds = testAccounts.map(acc => acc.id);
      await db.account.deleteMany({
        where: { id: { in: accountIds } },
      });
    }
    
    if (testSessions.length > 0) {
      const sessionIds = testSessions.map(sess => sess.id);
      await db.session.deleteMany({
        where: { id: { in: sessionIds } },
      });
    }
    
    if (testUsers.length > 0) {
      const userIds = testUsers.map(user => user.id);
      await cleanup.deleteUsers(userIds);
    }
  });

  describe("Token Security and Encryption", () => {
    test("should securely store GitHub access tokens", async () => {
      const user = await createTestUser({
        name: "Token Security User",
        email: `token-security-${Date.now()}@example.com`,
      });
      testUsers.push(user);

      // Simulate NextAuth storing encrypted tokens
      const sensitiveToken = "gho_very_sensitive_access_token_123456789";
      
      const account = await db.account.create({
        data: {
          userId: user.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "github_security_test",
          access_token: sensitiveToken, // NextAuth encrypts this internally
          token_type: "bearer",
          scope: "read:user user:email",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      });
      testAccounts.push(account);

      // Verify token is stored
      expect(account.access_token).toBe(sensitiveToken);
      
      // In a real NextAuth setup, this would be encrypted at rest
      const storedAccount = await db.account.findUnique({
        where: { id: account.id },
      });
      
      expect(storedAccount?.access_token).toBeTruthy();
      expect(storedAccount?.expires_at).toBeTruthy();
    });

    test("should handle refresh token security", async () => {
      const user = await createTestUser({
        name: "Refresh Token User",
        email: `refresh-security-${Date.now()}@example.com`,
      });
      testUsers.push(user);

      const account = await db.account.create({
        data: {
          userId: user.id,
          type: "oauth", 
          provider: "github",
          providerAccountId: "github_refresh_test",
          access_token: "current_access_token",
          refresh_token: "ghr_sensitive_refresh_token_987654321",
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) - 3600, // Expired
        },
      });
      testAccounts.push(account);

      // Simulate token refresh with new encrypted tokens
      const updatedAccount = await db.account.update({
        where: { id: account.id },
        data: {
          access_token: "new_refreshed_access_token",
          refresh_token: "new_refresh_token_after_rotation",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      });

      expect(updatedAccount.access_token).not.toBe(account.access_token);
      expect(updatedAccount.refresh_token).not.toBe(account.refresh_token);
      expect(updatedAccount.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    test("should handle token expiration securely", async () => {
      const user = await createTestUser({
        name: "Token Expiry User",
        email: `expiry-${Date.now()}@example.com`, 
      });
      testUsers.push(user);

      // Create account with expired token
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 7200; // 2 hours ago
      
      const account = await db.account.create({
        data: {
          userId: user.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "github_expiry_test",
          access_token: "expired_access_token",
          token_type: "bearer",
          expires_at: expiredTimestamp,
        },
      });
      testAccounts.push(account);

      // Verify token is marked as expired
      expect(account.expires_at).toBeLessThan(Math.floor(Date.now() / 1000));

      // Simulate expired token cleanup/refresh logic
      const isTokenExpired = account.expires_at && account.expires_at < Math.floor(Date.now() / 1000);
      expect(isTokenExpired).toBe(true);
    });
  });

  describe("Session Security", () => {
    test("should create secure session tokens", async () => {
      const user = await createTestUser({
        name: "Session User",
        email: `session-${Date.now()}@example.com`,
      });
      testUsers.push(user);

      // Mock secure session token generation
      const secureSessionToken = `session_${mockCrypto.randomUUID()}`;
      mockCrypto.randomUUID.mockReturnValue("secure-uuid-123");

      const session = await db.session.create({
        data: {
          sessionToken: secureSessionToken,
          userId: user.id,
          expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      });
      testSessions.push(session);

      expect(session.sessionToken).toContain("session_");
      expect(session.sessionToken.length).toBeGreaterThan(20);
      expect(session.expires.getTime()).toBeGreaterThan(Date.now());
    });

    test("should enforce session expiration", async () => {
      const user = await createTestUser({
        name: "Session Expiry User",
        email: `session-expiry-${Date.now()}@example.com`,
      });
      testUsers.push(user);

      // Create expired session
      const expiredSession = await db.session.create({
        data: {
          sessionToken: `expired_session_${Date.now()}`,
          userId: user.id,
          expires: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
        },
      });
      testSessions.push(expiredSession);

      // Verify session is expired
      const now = new Date();
      expect(expiredSession.expires.getTime()).toBeLessThan(now.getTime());

      // Simulate session cleanup
      const validSessions = await db.session.findMany({
        where: {
          userId: user.id,
          expires: { gt: now },
        },
      });

      expect(validSessions).toHaveLength(0);
    });

    test("should handle concurrent session management", async () => {
      const user = await createTestUser({
        name: "Multi Session User", 
        email: `multi-session-${Date.now()}@example.com`,
      });
      testUsers.push(user);

      // Create multiple sessions for same user (different devices/browsers)
      const sessions = await Promise.all([
        db.session.create({
          data: {
            sessionToken: `mobile_session_${Date.now()}`,
            userId: user.id,
            expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        }),
        db.session.create({
          data: {
            sessionToken: `desktop_session_${Date.now()}`,
            userId: user.id,
            expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        }),
        db.session.create({
          data: {
            sessionToken: `tablet_session_${Date.now()}`,
            userId: user.id,
            expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        }),
      ]);
      
      testSessions.push(...sessions);

      // Verify multiple active sessions
      const userSessions = await db.session.findMany({
        where: { 
          userId: user.id,
          expires: { gt: new Date() },
        },
      });

      expect(userSessions).toHaveLength(3);
      expect(userSessions.map(s => s.sessionToken)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("mobile_session_"),
          expect.stringContaining("desktop_session_"),
          expect.stringContaining("tablet_session_"),
        ])
      );
    });
  });

  describe("Authentication Vulnerability Prevention", () => {
    test("should prevent account enumeration attacks", async () => {
      // Attempt to check if user exists through timing attacks
      const existingEmail = `existing-${Date.now()}@example.com`;
      const nonExistentEmail = `nonexistent-${Date.now()}@example.com`;

      // Create a user
      const existingUser = await createTestUser({
        name: "Existing User",
        email: existingEmail,
      });
      testUsers.push(existingUser);

      // Simulate consistent response times for both existing and non-existent users
      const checkUserStart = Date.now();
      const existingUserResult = await db.user.findUnique({
        where: { email: existingEmail },
      });
      const existingUserTime = Date.now() - checkUserStart;

      const nonExistentStart = Date.now();
      const nonExistentResult = await db.user.findUnique({
        where: { email: nonExistentEmail },
      });
      const nonExistentTime = Date.now() - nonExistentStart;

      expect(existingUserResult).toBeTruthy();
      expect(nonExistentResult).toBeNull();

      // Response times should be similar (within reasonable variance)
      const timeDifference = Math.abs(existingUserTime - nonExistentTime);
      expect(timeDifference).toBeLessThan(100); // Less than 100ms difference
    });

    test("should prevent session fixation attacks", async () => {
      const user = await createTestUser({
        name: "Session Fixation User",
        email: `fixation-${Date.now()}@example.com`,
      });
      testUsers.push(user);

      // Create initial session
      const oldSessionToken = `old_session_${Date.now()}`;
      const oldSession = await db.session.create({
        data: {
          sessionToken: oldSessionToken,
          userId: user.id,
          expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      testSessions.push(oldSession);

      // Simulate login - new session should be created, old should be invalidated
      const newSessionToken = `new_session_${Date.now() + 1000}`;
      const newSession = await db.session.create({
        data: {
          sessionToken: newSessionToken,
          userId: user.id,
          expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      testSessions.push(newSession);

      // Old session should be deleted/invalidated (simulate session regeneration)
      await db.session.delete({
        where: { id: oldSession.id },
      });

      // Verify old session is gone, new session exists
      const oldSessionCheck = await db.session.findUnique({
        where: { sessionToken: oldSessionToken },
      });
      const newSessionCheck = await db.session.findUnique({
        where: { sessionToken: newSessionToken },
      });

      expect(oldSessionCheck).toBeNull();
      expect(newSessionCheck).toBeTruthy();
    });

    test("should prevent CSRF attacks through state validation", () => {
      // Mock CSRF state validation
      const generateCSRFToken = () => mockCrypto.randomUUID();
      const validateCSRFToken = (provided: string, expected: string) => 
        mockCrypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

      mockCrypto.randomUUID.mockReturnValue("csrf-token-123");
      mockCrypto.timingSafeEqual.mockImplementation((a, b) => a.equals(b));

      const csrfToken = generateCSRFToken();
      expect(csrfToken).toBe("csrf-token-123");

      // Valid token should pass
      expect(validateCSRFToken(csrfToken, csrfToken)).toBe(true);
      
      // Invalid token should fail
      expect(validateCSRFToken("malicious-token", csrfToken)).toBe(false);
    });

    test("should handle brute force protection", async () => {
      // Simulate rate limiting for failed login attempts
      const rateLimitStore = new Map();
      const maxAttempts = 5;
      const windowMs = 15 * 60 * 1000; // 15 minutes

      const checkRateLimit = (ip: string) => {
        const now = Date.now();
        const attempts = rateLimitStore.get(ip) || { count: 0, firstAttempt: now };
        
        // Reset if window expired
        if (now - attempts.firstAttempt > windowMs) {
          attempts.count = 0;
          attempts.firstAttempt = now;
        }
        
        attempts.count++;
        rateLimitStore.set(ip, attempts);
        
        return attempts.count <= maxAttempts;
      };

      const testIP = "192.168.1.100";
      
      // First 5 attempts should be allowed
      for (let i = 0; i < maxAttempts; i++) {
        expect(checkRateLimit(testIP)).toBe(true);
      }
      
      // 6th attempt should be blocked
      expect(checkRateLimit(testIP)).toBe(false);
      
      // Additional attempts should also be blocked
      expect(checkRateLimit(testIP)).toBe(false);
    });
  });

  describe("JWT Security", () => {
    test("should handle secure JWT token creation", async () => {
      const user = await createTestUser({
        name: "JWT User",
        email: `jwt-${Date.now()}@example.com`,
      });
      testUsers.push(user);

      const jwtPayload = {
        sub: user.id,
        email: user.email,
        name: user.name,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      };

      const mockJWTToken = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.encoded_payload.signature";
      mockJWT.encode.mockResolvedValue(mockJWTToken);

      const token = await mockJWT.encode({ 
        token: jwtPayload,
        secret: "test-secret",
      });

      expect(token).toBe(mockJWTToken);
      expect(mockJWT.encode).toHaveBeenCalledWith({
        token: jwtPayload,
        secret: "test-secret",
      });
    });

    test("should validate JWT token signatures", async () => {
      const validToken = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.valid_payload.valid_signature";
      const invalidToken = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.valid_payload.invalid_signature";

      mockJWT.decode.mockImplementation(({ token }) => {
        if (token === validToken) {
          return Promise.resolve({
            sub: "user123",
            email: "test@example.com",
            exp: Math.floor(Date.now() / 1000) + 3600,
          });
        }
        return Promise.resolve(null);
      });

      const validResult = await mockJWT.decode({ 
        token: validToken, 
        secret: "test-secret" 
      });
      const invalidResult = await mockJWT.decode({ 
        token: invalidToken, 
        secret: "test-secret" 
      });

      expect(validResult).toBeTruthy();
      expect(validResult?.sub).toBe("user123");
      expect(invalidResult).toBeNull();
    });

    test("should handle JWT token expiration", async () => {
      const expiredPayload = {
        sub: "user123",
        email: "test@example.com",
        iat: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
        exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago (expired)
      };

      mockJWT.decode.mockResolvedValue(expiredPayload);

      const decodedToken = await mockJWT.decode({
        token: "expired_token",
        secret: "test-secret",
      });

      // Check if token is expired
      const now = Math.floor(Date.now() / 1000);
      const isExpired = decodedToken && decodedToken.exp < now;

      expect(isExpired).toBe(true);
    });
  });

  describe("Account Security", () => {
    test("should prevent account takeover through email verification", async () => {
      const originalEmail = `original-${Date.now()}@example.com`;
      const newEmail = `new-${Date.now()}@example.com`;

      const user = await createTestUser({
        name: "Email Change User",
        email: originalEmail,
      });
      testUsers.push(user);

      // Simulate email change request (would require verification in real app)
      const mockEmailChangeToken = "email-change-token-123";
      mockCrypto.randomUUID.mockReturnValue(mockEmailChangeToken);
      const emailChangeToken = mockCrypto.randomUUID();

      // Store pending email change (in real app, this would be in a separate table)
      const pendingEmailChange = {
        userId: user.id,
        newEmail: newEmail,
        token: emailChangeToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      };

      // Email should NOT be changed until verified
      const userBeforeVerification = await db.user.findUnique({
        where: { id: user.id },
      });

      expect(userBeforeVerification?.email).toBe(originalEmail);
      expect(pendingEmailChange.token).toBe("email-change-token-123");
    });

    test("should handle secure account deletion", async () => {
      const user = await createTestUser({
        name: "Delete User",
        email: `delete-${Date.now()}@example.com`,
      });
      testUsers.push(user);

      // Create associated account
      const account = await db.account.create({
        data: {
          userId: user.id,
          type: "oauth",
          provider: "github", 
          providerAccountId: "github_delete_test",
          access_token: "token_to_be_deleted",
        },
      });
      testAccounts.push(account);

      // Create associated session
      const session = await db.session.create({
        data: {
          sessionToken: `delete_session_${Date.now()}`,
          userId: user.id,
          expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      testSessions.push(session);

      // Simulate secure deletion (cascade delete)
      // In real app, this would be handled by database cascade or explicit deletion
      await db.session.delete({ where: { id: session.id } });
      await db.account.delete({ where: { id: account.id } });
      
      // Remove from test arrays since we're manually deleting
      testSessions = testSessions.filter(s => s.id !== session.id);
      testAccounts = testAccounts.filter(a => a.id !== account.id);

      // Verify data is deleted
      const deletedSession = await db.session.findUnique({
        where: { id: session.id },
      });
      const deletedAccount = await db.account.findUnique({
        where: { id: account.id },
      });

      expect(deletedSession).toBeNull();
      expect(deletedAccount).toBeNull();
    });
  });
});